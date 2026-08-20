"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import {
  comparePrice,
  lineArithmeticGap,
  normaliseName,
  purchaseStatus,
  purchaseTotalsFromLines,
  round2,
} from "@/lib/purchases";
import { validatePurchase, hasErrors } from "@/lib/validation";
import { safeReturnTo } from "@/lib/safeReturnTo";
import { RECONCILE_TOLERANCE } from "@/lib/invoice/reconcile";
import type { SupplierResolution, ItemResolution } from "@/lib/invoice/resolve";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";
import { SupplierFields } from "@/components/purchases/SupplierFields";
import TradeSelect from "@/components/forms/TradeSelect";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  VAT_RATES,
  type InvoiceRef,
  type ItemRef,
  type PurchaseEditBundle,
  type PurchaseFormBundle,
  type PurchaseInput,
  type TradeLookup,
} from "@/types";

// One invoice, entered by hand, with as many lines as the document has.
//
// This is the form the whole transaction core was built for: the header is the
// document (who, when, which invoice) and the lines are the things on it. What
// used to be one flat expense row is now a header plus N lines, so "nails,
// plaster and planks all came on the same invoice" survives being written down.
//
// Three rules it is built on:
//
//  • The totals are never typed. Net, VAT and gross are the sum of the lines,
//    recomputed here as you type and again on the server when it saves, so the
//    header can never disagree with the document.
//  • The warnings are per line, not per document. "You are paying 29% more for
//    sand" is useful; "something on this invoice went up" is not.
//  • A percentage is never shown across two different units. comparePrice
//    returns no number when the unit changed, and PriceMoveBadge says
//    "bag → tonne — check pack size" instead (about.md §8.1).
//
// Nothing here blocks a save except the rules the database itself would
// reject. Every advisory below is a warning you can ignore — a real invoice is
// allowed to be odd.

interface LineState {
  key: string;
  id: string | null;
  // Left null except when a review-screen item suggestion is confirmed
  // (see "Use this item" below). buildPayload sends whatever is here — null
  // means "let the server match the text", exactly as it always has.
  item_id: string | null;
  description_raw: string;
  qty: string;
  unit: string;
  unit_price: string;
  line_net: string;
  vat_rate: string;
  // Carried with the line, not looked up by index, so removing an earlier
  // line can never point this at the wrong suggestion.
  itemResolution: ItemResolution | null;
}

interface PaymentState {
  key: string;
  id: string | null;
  paid_on: string;
  amount: string;
  method: string;
  reference: string;
}

// Every header field is held as a string, the way an input gives it back, and
// is narrowed to its real type once — in buildPayload. Validation then runs
// over the same object the server will receive.
interface HeaderState {
  supplier_name: string;
  purchase_date: string;
  invoice_no: string;
  week_no: string;
  category: string;
  trade: string;
  location_room: string;
  notes: string;
  entry_status: string;
}

let sequence = 0;
const nextKey = () => `row-${(sequence += 1)}`;

const blankLine = (vatRate: string): LineState => ({
  key: nextKey(),
  id: null,
  item_id: null,
  description_raw: "",
  qty: "",
  unit: "",
  unit_price: "",
  line_net: "",
  vat_rate: vatRate,
  itemResolution: null,
});

const blankPayment = (): PaymentState => ({
  key: nextKey(),
  id: null,
  paid_on: new Date().toISOString().slice(0, 10),
  amount: "",
  method: "",
  reference: "",
});

const asNumber = (value: string): number => Number(value || 0);

// Distinct, trimmed, case-insensitively de-duplicated values for a datalist —
// the same helper idea the expense form uses.
function options(values: (string | null | undefined)[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const clean = value?.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, clean);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

// What the review screen hands in to prefill a blank form from an extraction.
// Only consulted when `purchase` is absent — editing always wins (§ below).
// Every field is a plain string exactly as an input would hold it, same as
// HeaderState/LineState/PaymentState, so there is one coercion point
// (buildPayload) rather than two.
export interface PurchaseFormPrefill {
  purchase_date: string;
  invoice_no: string;
  category: string;
  location_room: string;
  notes: string;
  lines: {
    description_raw: string;
    qty: string;
    unit: string;
    unit_price: string;
    line_net: string;
    vat_rate: string;
  }[];
  payments: {
    paid_on: string;
    amount: string;
    method: string;
    reference: string;
  }[];
  // The invoice's own printed total, incl. VAT. Prefilling it into "Invoice
  // total as printed" makes the existing grossMismatch check run immediately,
  // live, against whatever the lines say — no separate static warning needed.
  stated_gross: string;
}

// Where the Supplier field starts, worked out once from the resolver's
// verdict rather than re-derived in three different places:
//   certain / likely -> the candidate's own canonical name (pre-selected).
//   possible / none  -> the raw text off the document, or the drafted name
//                       for "none" — nothing is pre-selected as a real match.
function initialSupplierName(resolution: SupplierResolution | null | undefined): string {
  if (!resolution) return "";
  if (resolution.selected_supplier_id) {
    const match = resolution.candidates.find(
      (c) => c.supplier_id === resolution.selected_supplier_id
    );
    if (match) return match.name;
  }
  if (resolution.confidence === "none")
    return resolution.draft?.name ?? resolution.raw_name ?? "";
  return resolution.raw_name ?? "";
}

export default function PurchaseForm({
  bundle,
  purchase,
  prefill,
  invoiceUploadId,
  supplierResolution,
  lineResolutions,
  extractedTotals,
  documentNotes,
  returnTo,
}: {
  bundle: PurchaseFormBundle;
  purchase?: PurchaseEditBundle;
  // The next four are only ever set together, by the invoice review screen
  // (app/(app)/invoices/[uploadId]/review). Manual entry and editing never
  // pass them, so every branch below that checks for them is new code the
  // old paths never reach.
  prefill?: PurchaseFormPrefill;
  invoiceUploadId?: string;
  supplierResolution?: SupplierResolution | null;
  lineResolutions?: ItemResolution[];
  extractedTotals?: { net_total: number | null; vat_total: number | null } | null;
  documentNotes?: string[];
  // Where Cancel and a successful Save should land instead of the default
  // invoice list — e.g. back on the Expenses tab this invoice was opened
  // from. Only `purchases/[pid]/edit` passes one today; invoices/new and the
  // review screen leave it undefined, so their behaviour is unchanged.
  // Re-validated here (not just where the query string was read) because
  // this is the one form shared by all three callers.
  returnTo?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const uid = useId();
  const editing = Boolean(purchase);

  // Which project this invoice gets filed against.
  //
  // Fixed when the route already says so (editing, or any project-scoped
  // screen); chosen here otherwise — the nav-bar flow uploads a document
  // before anyone has decided which job it belongs to, so the decision lands
  // at the moment it is saved instead (about.md §8.2). It starts blank rather
  // than guessing: filing an invoice against the wrong job is a wrong number
  // nobody chose, and a blank the form refuses to save is a question.
  const fixedProjectId = purchase?.purchase.project_id ?? bundle.project?.id ?? null;
  const [projectId, setProjectId] = useState<string>(fixedProjectId ?? "");
  const choosingProject = !fixedProjectId;

  // Re-validated even though the caller already checked: this is the one
  // form three different routes render, so trust nothing an untrusted query
  // string put on the props of any one of them.
  const safeTarget = safeReturnTo(returnTo);

  const [header, setHeader] = useState<HeaderState>(() => ({
    supplier_name: purchase?.supplier_name ?? initialSupplierName(supplierResolution),
    purchase_date:
      purchase?.purchase.purchase_date ??
      prefill?.purchase_date ??
      new Date().toISOString().slice(0, 10),
    invoice_no: purchase?.purchase.invoice_no ?? prefill?.invoice_no ?? "",
    // Blank until a project is picked — a week number means nothing on its own
    // (see chooseProject), so there is nothing honest to prefill it with yet.
    week_no:
      purchase?.purchase.week_no?.toString() ??
      (bundle.project ? String(bundle.next_week) : ""),
    category: purchase?.purchase.category ?? prefill?.category ?? "Materials",
    trade: purchase?.purchase.trade ?? "",
    location_room: purchase?.purchase.location_room ?? prefill?.location_room ?? "",
    notes: purchase?.purchase.notes ?? prefill?.notes ?? "",
    entry_status: purchase?.purchase.entry_status ?? "Planned",
  }));

  const [lines, setLines] = useState<LineState[]>(() => {
    if (purchase && purchase.lines.length > 0)
      return purchase.lines.map((l) => ({
        key: nextKey(),
        id: l.id,
        item_id: null,
        description_raw: l.description_raw,
        qty: Number(l.qty) > 0 ? String(Number(l.qty)) : "",
        unit: l.unit ?? "",
        unit_price:
          Number(l.unit_price) > 0 ? String(Number(l.unit_price)) : "",
        line_net: String(Number(l.line_net)),
        vat_rate: String(Number(l.vat_rate)),
        itemResolution: null,
      }));
    if (prefill && prefill.lines.length > 0)
      return prefill.lines.map((l, i) => ({
        key: nextKey(),
        id: null,
        item_id: null,
        description_raw: l.description_raw,
        qty: l.qty,
        unit: l.unit,
        unit_price: l.unit_price,
        line_net: l.line_net,
        vat_rate: l.vat_rate,
        itemResolution: lineResolutions?.[i] ?? null,
      }));
    return [blankLine("0")];
  });

  const [payments, setPayments] = useState<PaymentState[]>(() => {
    if (purchase)
      return purchase.payments.map((p) => ({
        key: nextKey(),
        id: p.id,
        paid_on: p.paid_on ?? "",
        amount: String(Number(p.amount)),
        method: p.method ?? "",
        reference: p.reference ?? "",
      }));
    return (prefill?.payments ?? []).map((p) => ({
      key: nextKey(),
      id: null,
      paid_on: p.paid_on,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
    }));
  });

  // What the paper says the invoice comes to. Never saved — it exists only to
  // check the typing, the way an invoice's own subtotal checks its lines
  // (evolution summary, "Arithmetic validation"). Prefilled from the
  // extraction's own printed total on the review screen, which turns the
  // existing check below into the reconciliation warning for free.
  const [statedGross, setStatedGross] = useState(prefill?.stated_gross ?? "");

  // ---- supplier resolution (review screen only — see supplierResolution) ----
  const [supplierChoice, setSupplierChoice] = useState<"candidate" | "draft" | "search">(
    () =>
      !supplierResolution
        ? "search"
        : supplierResolution.confidence === "none"
          ? "draft"
          : "candidate"
  );
  const [supplierConfirmed, setSupplierConfirmed] = useState(
    () => supplierResolution?.confidence === "certain"
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    () => supplierResolution?.selected_supplier_id ?? null
  );
  const [draftSupplier, setDraftSupplier] = useState(() => ({
    vat_number:
      supplierResolution?.draft?.vat_number ?? supplierResolution?.raw_vat_number ?? "",
    address: supplierResolution?.draft?.address ?? "",
  }));

  // ---- item resolution (review screen only — dismissed suggestions) ----
  const [dismissedItemSuggestions, setDismissedItemSuggestions] = useState<Set<string>>(
    new Set()
  );
  const [showMore, setShowMore] = useState(
    Boolean(purchase?.purchase.location_room || purchase?.purchase.notes)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Local copy so a trade added inline (TradeSelect's "+ Add new trade")
  // shows up in this form's own dropdown immediately, without a round trip.
  const [tradeList, setTradeList] = useState<TradeLookup[]>(bundle.trades);
  // Once the week has been typed by hand, changing project must not overwrite
  // it — see chooseProject.
  const weekTouched = useRef(editing || Boolean(purchase?.purchase.week_no));

  // ---- reference look-ups, all exact on the normalised text ----

  const itemByKey = useMemo(() => {
    const map = new Map<string, ItemRef>();
    for (const item of bundle.items) {
      map.set(normaliseName(item.canonical_name), item);
      for (const alias of item.aliases) {
        const key = normaliseName(alias);
        if (!map.has(key)) map.set(key, item);
      }
    }
    return map;
  }, [bundle.items]);

  const supplierByKey = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const supplier of bundle.suppliers) {
      map.set(normaliseName(supplier.name), supplier);
      for (const alias of supplier.aliases) {
        const key = normaliseName(alias);
        if (!map.has(key)) map.set(key, supplier);
      }
    }
    return map;
  }, [bundle.suppliers]);

  const matchedSupplier = supplierByKey.get(normaliseName(header.supplier_name));
  const supplierTyped = header.supplier_name.trim().length > 0;

  const supplierOptions = useMemo(
    () => options(bundle.suppliers.flatMap((s) => [s.name, ...s.aliases])),
    [bundle.suppliers]
  );
  const itemOptions = useMemo(
    () => options(bundle.items.map((i) => i.canonical_name)),
    [bundle.items]
  );

  // ---- totals: the sum of the lines, exactly as the server will compute ----

  const totals = useMemo(() => purchaseTotalsFromLines(lines), [lines]);
  const paid = useMemo(
    () => round2(payments.reduce((sum, p) => sum + asNumber(p.amount), 0)),
    [payments]
  );
  const balance = round2(totals.gross_total - paid);
  const status = purchaseStatus(totals.gross_total, paid);

  const grossMismatch = useMemo(() => {
    const stated = asNumber(statedGross);
    if (stated <= 0) return null;
    const gap = round2(stated - totals.gross_total);
    return Math.abs(gap) > 0.01 ? { stated, gap } : null;
  }, [statedGross, totals.gross_total]);

  // The other two legs of reconcile.ts's check, run live against whatever the
  // lines currently say rather than the one-off snapshot the extract route
  // computed — so editing a line updates the warning instead of leaving it
  // stale. Same tolerance the server-side check uses.
  const netMismatch = useMemo(() => {
    const stated = extractedTotals?.net_total;
    if (stated == null) return null;
    const gap = round2(stated - totals.net_total);
    return Math.abs(gap) > RECONCILE_TOLERANCE ? { stated, gap } : null;
  }, [extractedTotals, totals.net_total]);
  const vatMismatch = useMemo(() => {
    const stated = extractedTotals?.vat_total;
    if (stated == null) return null;
    const gap = round2(stated - totals.vat_total);
    return Math.abs(gap) > RECONCILE_TOLERANCE ? { stated, gap } : null;
  }, [extractedTotals, totals.vat_total]);

  const overpaid = paid - totals.gross_total > 0.005 ? paid - totals.gross_total : 0;

  // Same supplier, same invoice number — almost certainly the same document
  // logged twice. Checked across every project, because an invoice number
  // belongs to the merchant, not to the job.
  const duplicateInvoice = useMemo<InvoiceRef | null>(() => {
    const typed = normaliseName(header.invoice_no);
    if (!typed) return null;
    return (
      bundle.invoices.find(
        (inv) =>
          inv.purchase_id !== purchase?.purchase.id &&
          normaliseName(inv.invoice_no) === typed &&
          (matchedSupplier
            ? inv.supplier_id === matchedSupplier.id
            : normaliseName(inv.supplier_name ?? "") ===
              normaliseName(header.supplier_name))
      ) ?? null
    );
  }, [
    bundle.invoices,
    header.invoice_no,
    header.supplier_name,
    matchedSupplier,
    purchase?.purchase.id,
  ]);

  // ---- per-line advisories ----

  const lineInfo = useMemo(
    () =>
      lines.map((line, index) => {
        const key = normaliseName(line.description_raw);
        const item = key ? itemByKey.get(key) ?? null : null;
        const unitPrice = asNumber(line.unit_price);
        const last = item?.last_price ?? null;

        // No honest percentage exists without both prices, and none is shown
        // across two different units — that is what comparePrice is for.
        const move =
          last && unitPrice > 0
            ? comparePrice(
                { unit_price: unitPrice, unit: line.unit || null },
                { unit_price: last.unit_price, unit: last.unit }
              )
            : null;

        const duplicateOf = key
          ? lines.findIndex(
              (other, i) =>
                i < index && normaliseName(other.description_raw) === key
            )
          : -1;

        return {
          item,
          last,
          move,
          arithmetic: lineArithmeticGap(
            asNumber(line.qty),
            unitPrice,
            asNumber(line.line_net)
          ),
          duplicateOfLine: duplicateOf >= 0 ? duplicateOf + 1 : null,
          isNewItem: Boolean(key) && !item,
        };
      }),
    [lines, itemByKey]
  );

  // ---- editing helpers ----

  function setField(field: keyof HeaderState, value: string) {
    if (field === "week_no") weekTouched.current = true;
    setHeader((h) => ({ ...h, [field]: value }));
  }

  // Week numbers belong to a project — "week 7" of a job that has run four
  // weeks is a different thing from week 7 of one that has run twenty. Picking
  // a project therefore re-defaults the week, but never over a week the user
  // typed themselves.
  function chooseProject(id: string) {
    setProjectId(id);
    setErrors((e) => ({ ...e, project_id: "" }));
    if (weekTouched.current) return;
    setHeader((h) => ({
      ...h,
      week_no: id ? String(bundle.next_week_by_project[id] ?? 1) : "",
    }));
  }

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // Keep the line total in step with qty × unit price while it is still
        // the number this form put there. The moment you type your own figure,
        // it is left alone — invoices carry discounts and part-loads.
        if (patch.qty !== undefined || patch.unit_price !== undefined) {
          const wasDerived =
            line.line_net.trim() === "" ||
            Math.abs(
              round2(asNumber(line.qty) * asNumber(line.unit_price)) -
                asNumber(line.line_net)
            ) < 0.005;
          const derived = round2(asNumber(next.qty) * asNumber(next.unit_price));
          if (wasDerived && derived > 0) next.line_net = String(derived);
        }
        return next;
      })
    );
  }

  function addLine() {
    // A new line inherits the VAT rate of the last one: an invoice is usually
    // all one rate, and re-picking it every time is the sort of friction that
    // stops invoices being logged at all.
    setLines((current) => [
      ...current,
      // `|| "0"`, not `?? "0"`: a review-screen line whose rate could not be
      // stored holds "", and a new line must not inherit that blank.
      blankLine(current[current.length - 1]?.vat_rate || "0"),
    ]);
  }

  function removeLine(key: string) {
    setLines((current) =>
      current.length === 1 ? current : current.filter((l) => l.key !== key)
    );
  }

  function updatePayment(key: string, patch: Partial<PaymentState>) {
    setPayments((current) =>
      current.map((p) => (p.key === key ? { ...p, ...patch } : p))
    );
    // Once the money is covered, the document's own lifecycle flag almost
    // always wants to be Paid. Same nudge the expense form makes (§10.2), and
    // still only a default — Paid/Partial/Pending is derived from the payments
    // themselves and is shown separately below.
    if (patch.amount !== undefined) {
      setHeader((h) => {
        if (h.entry_status !== "Planned" && h.entry_status !== "In Progress")
          return h;
        const total = payments.reduce(
          (sum, p) => sum + (p.key === key ? asNumber(patch.amount ?? "") : asNumber(p.amount)),
          0
        );
        return totals.gross_total > 0 && total >= totals.gross_total - 0.005
          ? { ...h, entry_status: "Paid" }
          : h;
      });
    }
  }

  function payTheBalance() {
    setPayments((current) => [
      ...current,
      { ...blankPayment(), amount: String(round2(Math.max(balance, 0))) },
    ]);
  }

  function buildPayload(): PurchaseInput {
    return {
      supplier_name: header.supplier_name.trim(),
      purchase_date: header.purchase_date || null,
      week_no: header.week_no || null,
      invoice_no: header.invoice_no || null,
      category: (header.category || null) as PurchaseInput["category"],
      trade: header.trade || null,
      location_room: header.location_room || null,
      notes: header.notes || null,
      entry_status: header.entry_status as PurchaseInput["entry_status"],
      lines: lines.map((line) => ({
        id: line.id,
        // Null unless a review-screen item suggestion was confirmed (see
        // "Use this item" below): the server matches the text against the
        // item aliases itself, so there is one matcher rather than two that
        // can drift apart. Sending an id short-circuits that match for the
        // one case where the description was rewritten but should still land
        // on the item it was rewritten to.
        item_id: line.item_id,
        description_raw: line.description_raw.trim(),
        qty: line.qty || 0,
        unit: line.unit.trim() || null,
        unit_price: line.unit_price || 0,
        line_net: line.line_net || 0,
        vat_rate: line.vat_rate,
      })),
      // A blank payment row is not a payment. Dropping them here means adding
      // a row and changing your mind cannot fail the save.
      payments: payments
        .filter((p) => asNumber(p.amount) > 0)
        .map((p) => ({
          id: p.id,
          paid_on: p.paid_on || null,
          amount: p.amount,
          method: (p.method || null) as PurchaseInput["payments"][number]["method"],
          reference: p.reference.trim() || null,
        })),
    };
  }

  // What the review screen tells /api/invoices/[id]/commit about the
  // supplier, so it knows whether to write an alias and whether the supplier
  // is genuinely new. `raw_alias` is always the invoice's own raw text, never
  // header.supplier_name — the alias exists to match the *next* invoice,
  // which carries the raw string again, not whatever the user renamed it to.
  function buildSupplierDecision():
    | { mode: "existing"; supplier_id: string; raw_alias: string | null }
    | {
        mode: "new";
        name: string;
        vat_number: string | null;
        address: string | null;
        raw_alias: string | null;
      }
    | undefined {
    if (!supplierResolution) return undefined;
    if (supplierChoice === "candidate" && selectedCandidateId)
      return {
        mode: "existing",
        supplier_id: selectedCandidateId,
        raw_alias: supplierResolution.raw_name,
      };
    if (supplierChoice === "draft")
      return {
        mode: "new",
        name: header.supplier_name.trim(),
        vat_number: draftSupplier.vat_number.trim() || null,
        address: draftSupplier.address.trim() || null,
        raw_alias: supplierResolution.raw_name,
      };
    // "search", or "candidate" with nothing picked — the user bypassed
    // resolution and typed/chose a name directly. Falls through to
    // createPurchase's own exact-match-or-create, same as manual entry.
    return undefined;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    const found = validatePurchase(payload as unknown as Record<string, unknown>);
    // The project is the form's own field, not part of PurchaseInput — the
    // route carries it everywhere else — so it is checked here rather than in
    // validatePurchase. The server refuses a project-less commit too.
    if (!projectId) found.project_id = "Choose which project this invoice is for";
    setErrors(found);
    if (hasErrors(found)) {
      toast("Check the highlighted fields", "error");
      return;
    }

    setSaving(true);
    try {
      if (invoiceUploadId) {
        await apiFetch<{ purchase: { id: string } }>(
          `/api/invoices/${invoiceUploadId}/commit`,
          {
            method: "POST",
            body: JSON.stringify({
              purchase: payload,
              supplier: buildSupplierDecision(),
              project_id: projectId,
            }),
          }
        );
        toast("Invoice logged", "success");
        // Straight to the project it was filed against — the whole point of
        // choosing one here is to end up looking at that job's invoices.
        // (The review screen never sends a returnTo, so safeTarget is always
        // null here — this always falls through to that default.)
        router.push(safeTarget ?? `/projects/${projectId}/purchases`);
        router.refresh();
        return;
      }

      await apiFetch(
        editing
          ? `/api/projects/${projectId}/purchases/${purchase!.purchase.id}`
          : `/api/projects/${projectId}/purchases`,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        }
      );
      toast(editing ? "Invoice updated" : "Invoice logged", "success");
      // Back where the caller asked, e.g. the Expenses tab this was opened
      // from — or the project's invoice list, as before, when nobody asked.
      // router.refresh() forces the target route's server data to be
      // refetched rather than served from the router cache, so the Expenses
      // list shows this invoice's new values immediately rather than what it
      // said before the edit.
      router.push(safeTarget ?? `/projects/${projectId}/purchases`);
      router.refresh();
    } catch (err) {
      // The form is left alone on failure so the typing can be retried.
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await apiFetch(
        `/api/projects/${projectId}/purchases/${purchase!.purchase.id}`,
        { method: "DELETE" }
      );
      toast("Invoice deleted", "success");
      router.push(`/projects/${projectId}/purchases`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  // Back where you came from: the caller's returnTo target if it gave one,
  // else the project's invoice list, else the invoice menu when this form was
  // reached from the nav bar with no project chosen yet.
  const cancel = () =>
    router.push(
      safeTarget ?? (projectId ? `/projects/${projectId}/purchases` : "/invoices")
    );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <datalist id={`${uid}-suppliers`}>
        {supplierOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id={`${uid}-items`}>
        {itemOptions.map((i) => (
          <option key={i} value={i} />
        ))}
      </datalist>
      <datalist id={`${uid}-units`}>
        {bundle.units.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {/* ---------------- where it gets filed ----------------
          Only when the route didn't already say. First card on the page
          because it is the first question — everything below is about the
          document, this is about which job it belongs to. */}
      {choosingProject && (
        <fieldset className="card border-brand-100 bg-brand-50/40">
          <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
            Which project
          </legend>
          <label className="label" htmlFor="project_id">
            Project *
          </label>
          <select
            id="project_id"
            className="input sm:max-w-md"
            value={projectId}
            onChange={(e) => chooseProject(e.target.value)}
          >
            <option value="">— choose a project —</option>
            {bundle.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {errors.project_id ? (
            <p className="field-error">{errors.project_id}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              This invoice is saved against the project you pick here, and you
              are taken straight to it.
            </p>
          )}
        </fieldset>
      )}

      {/* ---------------- the document ---------------- */}
      <fieldset className="card">
        <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
          The invoice
        </legend>

        {documentNotes && documentNotes.length > 0 && (
          <ul className="mb-3 space-y-1">
            {documentNotes.map((note, i) => (
              <li key={i} className="field-warning">
                {note}
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="label" htmlFor="supplier_name">
              Supplier
            </label>
            {supplierResolution ? (
              supplierChoice === "candidate" && supplierConfirmed ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <span className="text-sm font-medium text-emerald-800">
                    {header.supplier_name}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-emerald-700 underline"
                    onClick={() => setSupplierConfirmed(false)}
                  >
                    Change
                  </button>
                </div>
              ) : supplierChoice === "candidate" ? (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800">{supplierResolution.reason}</p>
                  {supplierResolution.candidates.map((c) => (
                    <label
                      key={c.supplier_id}
                      className="flex min-h-touch cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="supplier-candidate"
                        checked={selectedCandidateId === c.supplier_id}
                        onChange={() => {
                          setSelectedCandidateId(c.supplier_id);
                          setField("supplier_name", c.name);
                        }}
                      />
                      <span className="flex-1">
                        {c.name}
                        {c.is_unverified && (
                          <span className="ml-1 text-xs text-amber-600">
                            (unverified)
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">
                        {Math.round(c.score * 100)}% match
                        {c.matched_on !== c.name ? ` via "${c.matched_on}"` : ""}
                      </span>
                    </label>
                  ))}
                  <div className="flex flex-wrap gap-3 pt-1">
                    <button
                      type="button"
                      className="text-xs font-semibold text-amber-800 underline"
                      onClick={() => {
                        setSupplierChoice("draft");
                        setSelectedCandidateId(null);
                        setField(
                          "supplier_name",
                          supplierResolution.draft?.name ?? supplierResolution.raw_name ?? ""
                        );
                      }}
                    >
                      None of these — add new supplier
                    </button>
                    <button
                      type="button"
                      className="text-xs text-gray-500 underline"
                      onClick={() => setSupplierChoice("search")}
                    >
                      Search existing suppliers instead
                    </button>
                  </div>
                </div>
              ) : supplierChoice === "draft" ? (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <button
                    type="button"
                    className="text-xs font-medium text-gray-600 underline"
                    onClick={() => setSupplierChoice("search")}
                  >
                    Search existing suppliers instead
                  </button>
                  <SupplierFields
                    value={{
                      name: header.supplier_name,
                      vat_number: draftSupplier.vat_number,
                      address: draftSupplier.address,
                    }}
                    onChange={(patch) => {
                      if (patch.name !== undefined) setField("supplier_name", patch.name);
                      setDraftSupplier((d) => ({
                        ...d,
                        ...(patch.vat_number !== undefined
                          ? { vat_number: patch.vat_number }
                          : {}),
                        ...(patch.address !== undefined ? { address: patch.address } : {}),
                      }));
                    }}
                    errors={{ name: errors.supplier_name }}
                  />
                  <p className="text-xs text-amber-700">
                    New supplier — created and marked unverified when you save.
                  </p>
                </div>
              ) : (
                <>
                  <input
                    id="supplier_name"
                    className="input"
                    list={`${uid}-suppliers`}
                    autoComplete="off"
                    maxLength={200}
                    value={header.supplier_name}
                    onChange={(e) => setField("supplier_name", e.target.value)}
                    placeholder="e.g. Lawsons"
                  />
                  {errors.supplier_name && (
                    <p className="field-error">{errors.supplier_name}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {matchedSupplier ? (
                      <>Existing supplier: {matchedSupplier.name}</>
                    ) : header.supplier_name.trim() ? (
                      <span className="text-amber-700">
                        New supplier — it will be created when you save
                      </span>
                    ) : null}
                  </p>
                </>
              )
            ) : (
              <>
                <input
                  id="supplier_name"
                  className="input"
                  list={`${uid}-suppliers`}
                  autoComplete="off"
                  maxLength={200}
                  value={header.supplier_name}
                  onChange={(e) => setField("supplier_name", e.target.value)}
                  placeholder="e.g. Lawsons"
                />
                {errors.supplier_name && (
                  <p className="field-error">{errors.supplier_name}</p>
                )}
                {supplierTyped && (
                  <p className="mt-1 text-xs text-gray-500">
                    {matchedSupplier ? (
                      <>Existing supplier: {matchedSupplier.name}</>
                    ) : (
                      <span className="text-amber-700">
                        New supplier — it will be created when you save
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="label" htmlFor="purchase_date">
              Date
            </label>
            <input
              id="purchase_date"
              type="date"
              className="input"
              value={header.purchase_date}
              onChange={(e) => setField("purchase_date", e.target.value)}
            />
            {errors.purchase_date && (
              <p className="field-error">{errors.purchase_date}</p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="invoice_no">
              Invoice number
            </label>
            <input
              id="invoice_no"
              className="input"
              autoComplete="off"
              value={header.invoice_no}
              onChange={(e) => setField("invoice_no", e.target.value)}
            />
          </div>
        </div>

        {duplicateInvoice && (
          <p className="field-warning">
            Invoice {duplicateInvoice.invoice_no} from this supplier is already
            logged
            {duplicateInvoice.purchase_date
              ? ` (${duplicateInvoice.purchase_date}`
              : " ("}
            , {formatCurrency(duplicateInvoice.gross)}).{" "}
            <Link
              href={`/projects/${duplicateInvoice.project_id}/purchases/${duplicateInvoice.purchase_id}/edit`}
              className="font-semibold underline"
            >
              View it
            </Link>{" "}
            Save anyway if this is genuinely a second document.
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="week_no">
              Week
            </label>
            <input
              id="week_no"
              type="number"
              inputMode="numeric"
              min={1}
              className="input"
              value={header.week_no}
              onChange={(e) => setField("week_no", e.target.value)}
            />
            {errors.week_no && <p className="field-error">{errors.week_no}</p>}
          </div>
          <div>
            <label className="label" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              className="input"
              value={header.category}
              onChange={(e) => setField("category", e.target.value)}
            >
              <option value="">—</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="trade">
              Trade
            </label>
            <TradeSelect
              id="trade"
              value={header.trade}
              trades={tradeList}
              onChange={(v) => setField("trade", v)}
              onTradeAdded={(t) => setTradeList((list) => [...list, t])}
            />
          </div>
          <div>
            <label className="label" htmlFor="entry_status">
              Status
            </label>
            <select
              id="entry_status"
              className="input"
              value={header.entry_status}
              onChange={(e) => setField("entry_status", e.target.value)}
            >
              {EXPENSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {errors.entry_status && (
              <p className="field-error">{errors.entry_status}</p>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Status is the job&rsquo;s own state. Whether the invoice is paid is
          worked out from the payments below, never typed.
        </p>

        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          className="mt-3 flex min-h-touch w-full items-center justify-between rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700"
          aria-expanded={showMore}
        >
          <span>Room and notes</span>
          <span aria-hidden>{showMore ? "▴" : "▾"}</span>
        </button>
        {showMore && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="location_room">
                Location / Room
              </label>
              <input
                id="location_room"
                className="input"
                value={header.location_room}
                onChange={(e) => setField("location_room", e.target.value)}
                placeholder="e.g. Kitchen"
              />
            </div>
            <div>
              <label className="label" htmlFor="notes">
                Notes
              </label>
              <textarea
                id="notes"
                className="input"
                rows={2}
                value={header.notes}
                onChange={(e) => setField("notes", e.target.value)}
              />
            </div>
          </div>
        )}
      </fieldset>

      {/* ---------------- the lines ---------------- */}
      <fieldset className="card">
        <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
          What was on it
        </legend>
        {errors.lines && <p className="field-error">{errors.lines}</p>}

        <div className="space-y-3">
          {lines.map((line, index) => {
            const info = lineInfo[index];
            return (
              <div
                key={line.key}
                className="rounded-lg border border-gray-200 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Line {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    className="text-xs text-red-600 hover:underline disabled:text-gray-300 disabled:no-underline"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
                  <div className="col-span-2 sm:col-span-3">
                    <label className="label" htmlFor={`${line.key}-description`}>
                      Description *
                    </label>
                    <input
                      id={`${line.key}-description`}
                      className="input"
                      list={`${uid}-items`}
                      autoComplete="off"
                      maxLength={200}
                      value={line.description_raw}
                      onChange={(e) =>
                        updateLine(line.key, { description_raw: e.target.value })
                      }
                      placeholder="as written on the invoice"
                    />
                    {errors[`lines.${index}.description_raw`] && (
                      <p className="field-error">
                        {errors[`lines.${index}.description_raw`]}
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`${line.key}-qty`}>
                      Qty
                    </label>
                    <input
                      id={`${line.key}-qty`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.001"
                      className="input"
                      value={line.qty}
                      onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                    />
                  </div>

                  <div className="sm:col-span-1">
                    <label className="label" htmlFor={`${line.key}-unit`}>
                      Unit
                    </label>
                    <input
                      id={`${line.key}-unit`}
                      className="input"
                      list={`${uid}-units`}
                      autoComplete="off"
                      value={line.unit}
                      onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                      placeholder="bag, m², hr"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`${line.key}-unit-price`}>
                      Unit price
                    </label>
                    <input
                      id={`${line.key}-unit-price`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.0001"
                      className="input"
                      value={line.unit_price}
                      onChange={(e) =>
                        updateLine(line.key, { unit_price: e.target.value })
                      }
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`${line.key}-net`}>
                      Line total (ex VAT)
                    </label>
                    <input
                      id={`${line.key}-net`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      className="input"
                      value={line.line_net}
                      onChange={(e) =>
                        updateLine(line.key, { line_net: e.target.value })
                      }
                    />
                    {errors[`lines.${index}.line_net`] && (
                      <p className="field-error">
                        {errors[`lines.${index}.line_net`]}
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`${line.key}-vat`}>
                      VAT
                    </label>
                    <select
                      id={`${line.key}-vat`}
                      className="input"
                      value={line.vat_rate}
                      onChange={(e) =>
                        updateLine(line.key, { vat_rate: e.target.value })
                      }
                    >
                      {/* Only ever present when the invoice reader could not
                          store the rate it read (see documentNotes). Without
                          it the select would silently display 0% for a blank
                          value — the exact substitution this is here to stop.
                          Validation refuses to save while it is selected. */}
                      {line.vat_rate === "" && <option value="">— pick —</option>}
                      {VAT_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                    </select>
                    {errors[`lines.${index}.vat_rate`] && (
                      <p className="field-error">
                        {errors[`lines.${index}.vat_rate`]}
                      </p>
                    )}
                  </div>
                </div>

                {/* What this line will be filed under. */}
                <p className="mt-2 text-xs text-gray-500">
                  {info.item ? (
                    <>Item: {info.item.canonical_name}</>
                  ) : info.isNewItem ? (
                    <span className="text-amber-700">
                      New item — it will be created when you save
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      Type what the invoice calls it
                    </span>
                  )}
                </p>

                {/* Price history for this line's item. */}
                {info.last && !info.move && (
                  <p className="mt-1 text-xs text-gray-500">
                    Last bought at {formatCurrency(info.last.unit_price)}
                    {info.last.unit ? ` per ${info.last.unit}` : ""}
                    {info.last.date ? ` on ${info.last.date}` : ""}
                    {info.last.supplier_name
                      ? ` from ${info.last.supplier_name}`
                      : ""}{" "}
                    ({info.last.entry_source} record).
                  </p>
                )}
                {info.last && info.move && (
                  <p className="mt-1 text-xs text-gray-600">
                    Was {formatCurrency(info.last.unit_price)}
                    {info.last.unit ? ` per ${info.last.unit}` : ""}
                    {info.last.date ? ` on ${info.last.date}` : ""} — now{" "}
                    {formatCurrency(asNumber(line.unit_price))}{" "}
                    <PriceMoveBadge
                      move={info.move.move}
                      deltaPct={info.move.delta_pct}
                      unit={line.unit || null}
                      previousUnit={info.last.unit}
                    />
                  </p>
                )}

                {info.duplicateOfLine && (
                  <p className="field-warning">
                    Already on line {info.duplicateOfLine}. Fine if the invoice
                    really lists it twice.
                  </p>
                )}

                {info.arithmetic && (
                  <p className="field-warning">
                    Qty × unit price is{" "}
                    {formatCurrency(info.arithmetic.expected)}, but the line
                    total says {formatCurrency(info.arithmetic.stated)}.{" "}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() =>
                        setLines((current) =>
                          current.map((l) =>
                            l.key === line.key
                              ? { ...l, line_net: String(info.arithmetic!.expected) }
                              : l
                          )
                        )
                      }
                    >
                      Use {formatCurrency(info.arithmetic.expected)}
                    </button>
                  </p>
                )}

                {/* A fuzzy item match from the review screen's resolver —
                    only shown when the exact match above didn't already find
                    it, and not after the user has dismissed it. */}
                {line.itemResolution &&
                  !info.item &&
                  !dismissedItemSuggestions.has(line.key) &&
                  (line.itemResolution.confidence === "likely" ||
                    line.itemResolution.confidence === "possible") &&
                  line.itemResolution.candidates[0] && (
                    <p className="field-warning">
                      Looks like{" "}
                      <span className="font-semibold">
                        {line.itemResolution.candidates[0].name}
                      </span>{" "}
                      ({Math.round(line.itemResolution.candidates[0].score * 100)}%
                      match).{" "}
                      <button
                        type="button"
                        className="font-semibold underline"
                        onClick={() => {
                          const candidate = line.itemResolution!.candidates[0];
                          updateLine(line.key, {
                            item_id: candidate.item_id,
                            description_raw: candidate.name,
                          });
                        }}
                      >
                        Use this item
                      </button>{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          setDismissedItemSuggestions((s) => new Set(s).add(line.key))
                        }
                      >
                        It&rsquo;s new
                      </button>
                    </p>
                  )}
              </div>
            );
          })}
        </div>

        <button type="button" className="btn-secondary mt-3" onClick={addLine}>
          + Add line
        </button>
      </fieldset>

      {/* ---------------- payments ---------------- */}
      <fieldset className="card">
        <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
          Payments
        </legend>
        <p className="mb-3 text-xs text-gray-500">
          One row per time money changed hands, each with its own date and
          method. What is still owed is worked out from these — it is never
          stored.
        </p>

        {payments.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing paid yet.</p>
        ) : (
          <div className="space-y-3">
            {payments.map((payment, index) => (
              <div
                key={payment.key}
                className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-3">
                  <label className="label" htmlFor={`${payment.key}-date`}>
                    Paid on
                  </label>
                  <input
                    id={`${payment.key}-date`}
                    type="date"
                    className="input"
                    value={payment.paid_on}
                    onChange={(e) =>
                      updatePayment(payment.key, { paid_on: e.target.value })
                    }
                  />
                  {errors[`payments.${index}.paid_on`] && (
                    <p className="field-error">
                      {errors[`payments.${index}.paid_on`]}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor={`${payment.key}-amount`}>
                    Amount
                  </label>
                  <input
                    id={`${payment.key}-amount`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="input"
                    value={payment.amount}
                    onChange={(e) =>
                      updatePayment(payment.key, { amount: e.target.value })
                    }
                  />
                  {errors[`payments.${index}.amount`] && (
                    <p className="field-error">
                      {errors[`payments.${index}.amount`]}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-3">
                  <label className="label" htmlFor={`${payment.key}-method`}>
                    Method
                  </label>
                  <select
                    id={`${payment.key}-method`}
                    className="input"
                    value={payment.method}
                    onChange={(e) =>
                      updatePayment(payment.key, { method: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="label" htmlFor={`${payment.key}-reference`}>
                    Reference
                  </label>
                  <input
                    id={`${payment.key}-reference`}
                    className="input"
                    value={payment.reference}
                    onChange={(e) =>
                      updatePayment(payment.key, { reference: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-2 flex items-end sm:col-span-1">
                  <button
                    type="button"
                    onClick={() =>
                      setPayments((current) =>
                        current.filter((p) => p.key !== payment.key)
                      )
                    }
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPayments((c) => [...c, blankPayment()])}
          >
            + Add payment
          </button>
          {balance > 0.005 && (
            <button type="button" className="btn-secondary" onClick={payTheBalance}>
              Pay the balance ({formatCurrency(balance)})
            </button>
          )}
        </div>

        {overpaid > 0 && (
          <p className="field-warning">
            Payments are {formatCurrency(overpaid)} more than the invoice comes
            to. Check the figures unless this was a deposit or an overpayment.
          </p>
        )}
      </fieldset>

      {/* ---------------- totals ---------------- */}
      <div className="rounded-lg bg-brand-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">
            Net of {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
          <span className="font-medium">{formatCurrency(totals.net_total)}</span>
        </div>
        {netMismatch && (
          <p className="field-warning">
            The lines come to {formatCurrency(totals.net_total)} but the
            invoice printed {formatCurrency(netMismatch.stated)} —{" "}
            {formatCurrency(Math.abs(netMismatch.gap))}{" "}
            {netMismatch.gap > 0
              ? "unaccounted for, so a line is probably missing"
              : "too much, so a line may be double-counted"}
            .
          </p>
        )}
        <div className="flex justify-between">
          <span className="text-gray-600">VAT</span>
          <span className="font-medium">{formatCurrency(totals.vat_total)}</span>
        </div>
        {vatMismatch && (
          <p className="field-warning">
            VAT on the lines comes to {formatCurrency(totals.vat_total)} but
            the invoice printed {formatCurrency(vatMismatch.stated)} —{" "}
            {formatCurrency(Math.abs(vatMismatch.gap))}. Check the rate on
            each line.
          </p>
        )}
        <div className="flex justify-between">
          <span className="text-gray-600">Total incl. VAT</span>
          <span className="font-medium">
            {formatCurrency(totals.gross_total)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Paid</span>
          <span className="font-medium">{formatCurrency(paid)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-brand-100 pt-1 text-base font-bold text-brand">
          <span>Still owed</span>
          <span className="flex items-center gap-2">
            <Badge label={status} />
            {formatCurrency(balance)}
          </span>
        </div>

        <div className="mt-3 border-t border-brand-100 pt-3">
          <label className="label" htmlFor="stated_gross">
            Invoice total as printed (optional check)
          </label>
          <input
            id="stated_gross"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="input"
            value={statedGross}
            onChange={(e) => setStatedGross(e.target.value)}
            placeholder="type what the paper says, incl. VAT"
          />
          <p className="mt-1 text-xs text-gray-500">
            Not saved. It only checks the lines against the document — if they
            disagree, a line is missing or mistyped.
          </p>
          {grossMismatch && (
            <p className="field-warning">
              The lines come to {formatCurrency(totals.gross_total)} but the
              invoice says {formatCurrency(grossMismatch.stated)} —{" "}
              {formatCurrency(Math.abs(grossMismatch.gap))}{" "}
              {grossMismatch.gap > 0 ? "missing" : "too much"}.
            </p>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0">
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving && <Spinner />}
          {editing ? "Save changes" : "Log invoice"}
        </button>
        <button type="button" className="btn-secondary" onClick={cancel}>
          Cancel
        </button>
        {editing && (
          <button
            type="button"
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete invoice"
        danger
        confirmLabel="Delete invoice"
        message={
          <>
            This removes the whole document — its {lines.length}{" "}
            {lines.length === 1 ? "line" : "lines"} and{" "}
            {payments.length === 1 ? "its payment" : `${payments.length} payments`}{" "}
            go with it.
          </>
        }
        onConfirm={() => {
          setConfirmDelete(false);
          handleDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
