// Server-side writes for the transaction core — the other half of
// lib/purchases.ts, which only ever reads.
//
// Two things happen here that do not happen anywhere else in this project:
//
// 1. Reference rows are created as a side effect. Typing a supplier or an item
//    that has never been seen creates it, along with the alias that spells it
//    the way you just did. Matching is EXACT on the normalised text — the same
//    rule as public.norm_key() and priceKey() — never fuzzy. Fuzzy matching
//    ("Lawson" vs "Lawsons") is Phase 3's job, where a human confirms each one
//    and the confirmation is remembered. Guessing here would silently merge two
//    real merchants.
//
// 2. A save touches three tables. Route Handlers cannot open a transaction, so
//    each write below is followed by a compensating clean-up if a later one
//    fails: a failed create deletes the purchase (lines, payments and receipts
//    cascade with it), and a failed edit puts the original lines and payments
//    back. The alternative — a Postgres function called through rpc — is what
//    Phase 3 will need for a 500-row import, and it can absorb this then. For
//    one hand-typed invoice, an insert of a handful of rows that cleans up
//    after itself is enough, and it does not add a migration that has to be run
//    by hand before the form works at all.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseName, purchaseTotalsFromLines, round2 } from "@/lib/purchases";
import type {
  ExpenseCategory,
  Payment,
  Purchase,
  PurchaseInput,
  PurchaseLine,
  PurchaseLineInput,
} from "@/types";

type Client = SupabaseClient;

// Postgres unique_violation: someone created the same reference row between our
// look-up and our insert. Not an error — look it up again and use theirs.
const UNIQUE_VIOLATION = "23505";

const text = (value: unknown): string | null => {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

const round = (value: unknown, places: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** places;
  return Math.round((n + Number.EPSILON) * factor) / factor;
};

// ============================================================
// Suppliers and items — exact match, or create
// ============================================================

async function findSupplierId(supabase: Client, name: string): Promise<string | null> {
  const key = normaliseName(name);
  if (!key) return null;
  const [{ data: suppliers }, { data: aliases }] = await Promise.all([
    supabase.from("suppliers").select("id, name"),
    supabase.from("supplier_aliases").select("supplier_id, alias"),
  ]);
  const hit = ((suppliers ?? []) as { id: string; name: string }[]).find(
    (s) => normaliseName(s.name) === key
  );
  if (hit) return hit.id;
  const alias = (
    (aliases ?? []) as { supplier_id: string; alias: string }[]
  ).find((a) => normaliseName(a.alias) === key);
  return alias?.supplier_id ?? null;
}

// Aliases are how the system remembers a spelling. A duplicate is harmless and
// expected — the row already says what we were about to say.
async function rememberAlias(
  supabase: Client,
  table: "supplier_aliases" | "item_aliases",
  row: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from(table).insert(row);
  if (error && error.code !== UNIQUE_VIOLATION)
    throw new Error(`Could not record the alias: ${error.message}`);
}

/** Match a typed supplier name exactly, or create the supplier and its alias. */
export async function resolveSupplierId(
  supabase: Client,
  userId: string,
  name: string | null | undefined
): Promise<string | null> {
  const clean = text(name);
  if (!clean) return null;

  const existing = await findSupplierId(supabase, clean);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("suppliers")
    .insert({ user_id: userId, name: clean })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findSupplierId(supabase, clean);
      if (raced) return raced;
    }
    throw new Error(`Could not create supplier "${clean}": ${error.message}`);
  }

  const id = (data as { id: string }).id;
  await rememberAlias(supabase, "supplier_aliases", {
    user_id: userId,
    supplier_id: id,
    alias: clean,
  });
  return id;
}

/**
 * One item id per line, keyed by the line's normalised description. Every
 * unseen description becomes a new item — that is what makes the price
 * timeline on /items work for anything typed in by hand.
 */
export async function resolveItemIds(
  supabase: Client,
  userId: string,
  lines: PurchaseLineInput[],
  category: ExpenseCategory | null
): Promise<Map<string, string>> {
  const wanted = new Map<string, PurchaseLineInput>();
  for (const line of lines) {
    const key = normaliseName(String(line.description_raw ?? ""));
    if (key && !wanted.has(key)) wanted.set(key, line);
  }
  const byKey = new Map<string, string>();
  if (wanted.size === 0) return byKey;

  const [{ data: items }, { data: aliases }] = await Promise.all([
    supabase.from("items").select("id, canonical_name"),
    supabase.from("item_aliases").select("item_id, alias"),
  ]);
  for (const item of (items ?? []) as { id: string; canonical_name: string }[])
    byKey.set(normaliseName(item.canonical_name), item.id);
  for (const alias of (aliases ?? []) as { item_id: string; alias: string }[]) {
    const key = normaliseName(alias.alias);
    if (!byKey.has(key)) byKey.set(key, alias.item_id);
  }

  for (const [key, line] of wanted) {
    if (byKey.has(key)) continue;
    const canonical = String(line.description_raw).trim();
    const { data, error } = await supabase
      .from("items")
      .insert({
        user_id: userId,
        canonical_name: canonical,
        // The document's category and the unit as written on the line are the
        // best evidence available at this point; both are editable later.
        category,
        default_unit: text(line.unit),
      })
      .select("id")
      .single();

    if (error) {
      if (error.code !== UNIQUE_VIOLATION)
        throw new Error(`Could not create item "${canonical}": ${error.message}`);
      const { data: again } = await supabase.from("items").select("id, canonical_name");
      const raced = ((again ?? []) as { id: string; canonical_name: string }[]).find(
        (i) => normaliseName(i.canonical_name) === key
      );
      if (!raced) throw new Error(`Could not create item "${canonical}".`);
      byKey.set(key, raced.id);
      continue;
    }

    const id = (data as { id: string }).id;
    byKey.set(key, id);
    await rememberAlias(supabase, "item_aliases", {
      user_id: userId,
      item_id: id,
      alias: canonical,
    });
  }

  return byKey;
}

// ============================================================
// Turning the form body into rows
// ============================================================

// The header fields the form owns. Deliberately NOT here: origin,
// entry_source, legacy_entry_id and quoted_gross. Editing a purchase must not
// silently reclassify it — a backfilled ledger row stays a ledger row, and
// what a job was quoted at is not something this form asks about.
function headerFields(input: PurchaseInput, category: ExpenseCategory | null) {
  const week = String(input.week_no ?? "").trim();
  return {
    purchase_date: text(input.purchase_date),
    week_no: week === "" ? null : Math.trunc(Number(week)),
    invoice_no: text(input.invoice_no),
    category,
    trade: text(input.trade),
    location_room: text(input.location_room),
    notes: text(input.notes),
    entry_status: input.entry_status,
  };
}

function lineRows(
  input: PurchaseInput,
  userId: string,
  purchaseId: string,
  itemIds: Map<string, string>
) {
  return input.lines.map((line, i) => {
    const description = String(line.description_raw).trim();
    return {
      user_id: userId,
      purchase_id: purchaseId,
      // Line numbers are positional and start at 1: they are the order the
      // items appear on the document, and (purchase_id, line_no) is unique.
      line_no: i + 1,
      item_id: text(line.item_id) ?? itemIds.get(normaliseName(description)) ?? null,
      description_raw: description,
      qty: round(line.qty, 3),
      unit: text(line.unit),
      unit_price: round(line.unit_price, 4),
      line_net: round2(Number(line.line_net) || 0),
      vat_rate: Number(line.vat_rate) || 0,
    };
  });
}

function paymentRows(input: PurchaseInput, userId: string, purchaseId: string) {
  return input.payments
    .filter((p) => Number(p.amount) > 0)
    .map((p) => ({
      user_id: userId,
      purchase_id: purchaseId,
      paid_on: text(p.paid_on),
      // Incl-VAT: what was actually handed over, measured against gross_total
      // and never against net_total (about.md §3.1).
      amount: round2(Number(p.amount) || 0),
      method: text(p.method),
      reference: text(p.reference),
    }));
}

// ============================================================
// Create, update, delete
// ============================================================

/** Log a new invoice: its header, its lines and any payments already made. */
export async function createPurchase(
  supabase: Client,
  userId: string,
  projectId: string,
  input: PurchaseInput
): Promise<Purchase> {
  const category = (text(input.category) as ExpenseCategory | null) ?? null;
  const supplierId = await resolveSupplierId(supabase, userId, input.supplier_name);
  const itemIds = await resolveItemIds(supabase, userId, input.lines, category);
  const totals = purchaseTotalsFromLines(input.lines);

  const { data, error } = await supabase
    .from("purchases")
    .insert({
      ...headerFields(input, category),
      user_id: userId,
      project_id: projectId,
      supplier_id: supplierId,
      net_total: totals.net_total,
      vat_total: totals.vat_total, // gross_total is generated by Postgres
      origin: "manual",
      // Anything entered by hand is part of the week-by-week record, never the
      // imported reference set. The two overlap, so the distinction has to be
      // deliberate (about.md §5).
      entry_source: "diary",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const purchase = data as Purchase;
  try {
    const lines = lineRows(input, userId, purchase.id, itemIds);
    const { error: lineError } = await supabase.from("purchase_lines").insert(lines);
    if (lineError) throw new Error(lineError.message);

    const payments = paymentRows(input, userId, purchase.id);
    if (payments.length > 0) {
      const { error: payError } = await supabase.from("payments").insert(payments);
      if (payError) throw new Error(payError.message);
    }
  } catch (e) {
    // A purchase with no lines is worse than no purchase: it holds money that
    // nothing explains. Take it back out — lines and payments cascade.
    await supabase.from("purchases").delete().eq("id", purchase.id);
    throw e;
  }

  return purchase;
}

/**
 * Replace a purchase's header, lines and payments with what the form now says.
 *
 * Lines are replaced rather than merged: (purchase_id, line_no) is unique, so
 * re-numbering in place would collide with itself, and an invoice is small
 * enough that rewriting it is simpler than diffing it. The originals are held
 * in memory and put back if the re-insert fails.
 */
export async function updatePurchase(
  supabase: Client,
  userId: string,
  purchaseId: string,
  input: PurchaseInput
): Promise<Purchase> {
  const category = (text(input.category) as ExpenseCategory | null) ?? null;
  const supplierId = await resolveSupplierId(supabase, userId, input.supplier_name);
  const itemIds = await resolveItemIds(supabase, userId, input.lines, category);
  const totals = purchaseTotalsFromLines(input.lines);

  const [{ data: oldLines }, { data: oldPayments }] = await Promise.all([
    supabase.from("purchase_lines").select("*").eq("purchase_id", purchaseId),
    supabase.from("payments").select("*").eq("purchase_id", purchaseId),
  ]);

  const { data, error } = await supabase
    .from("purchases")
    .update({
      ...headerFields(input, category),
      supplier_id: supplierId,
      net_total: totals.net_total,
      vat_total: totals.vat_total,
    })
    .eq("id", purchaseId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  try {
    await supabase.from("purchase_lines").delete().eq("purchase_id", purchaseId);
    await supabase.from("payments").delete().eq("purchase_id", purchaseId);

    const { error: lineError } = await supabase
      .from("purchase_lines")
      .insert(lineRows(input, userId, purchaseId, itemIds));
    if (lineError) throw new Error(lineError.message);

    const payments = paymentRows(input, userId, purchaseId);
    if (payments.length > 0) {
      const { error: payError } = await supabase.from("payments").insert(payments);
      if (payError) throw new Error(payError.message);
    }
  } catch (e) {
    // Put the document back as it was, ids and all, rather than leave it empty.
    await supabase.from("purchase_lines").delete().eq("purchase_id", purchaseId);
    await supabase.from("payments").delete().eq("purchase_id", purchaseId);
    if ((oldLines ?? []).length > 0)
      await supabase.from("purchase_lines").insert(oldLines as PurchaseLine[]);
    if ((oldPayments ?? []).length > 0)
      await supabase.from("payments").insert(oldPayments as Payment[]);
    throw e;
  }

  return data as Purchase;
}
