// Deciding which merchant, and which item, an extracted invoice is about.
//
// The whole design turns on one asymmetry: **a wrong match is much worse than
// no match.** Two merchants silently merged into one corrupts every figure on
// /suppliers, and nothing on screen says it happened. An unmatched merchant is
// a dropdown the owner picks from once. So this file never decides anything on
// its own — it returns candidates, a confidence band, and its reasoning, and
// the review screen shows all three.
//
// Three tiers, tried in order, most trustworthy first:
//
//   1. VAT number, exact.  The only hard identifier an invoice carries. If the
//      numbers match, it is the same company, whatever the name says.
//   2. Name or alias, exact on the normalised text.  Same rule as
//      public.norm_key() and lib/purchaseWrite.ts — the matcher this project
//      already had, unchanged.
//   3. Trigram similarity, top five, via public.match_suppliers().  Never
//      auto-accepted. This tier's whole output is a question.
//
// Only tiers 1 and 2 are certain. Tier 3 is a suggestion, and below the
// threshold nothing is suggested at all and a new supplier is drafted instead.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseName, normaliseVat } from "@/lib/invoice/normalise";
import type { InvoiceUpload, Supplier } from "@/types";

type Client = SupabaseClient;

// ============================================================
// Confidence
// ============================================================

//   certain  — VAT or exact-text match. Pre-selected; no question asked.
//   likely   — trigram score at or above LIKELY. Pre-selected, but the review
//              screen says which name it matched and how well, in amber.
//   possible — trigram score at or above SUGGEST. Offered, NOT pre-selected.
//   none     — nothing worth showing. A new supplier is drafted.
export type MatchConfidence = "certain" | "likely" | "possible" | "none";

export type MatchTier = "vat" | "exact" | "fuzzy" | "none";

/**
 * Where the two trigram thresholds came from, and why they are these numbers.
 *
 * pg_trgm's similarity() is the proportion of shared three-character shingles.
 * On real merchant names the useful band is narrow:
 *
 *   "lawsons"        vs "lawsons timber"       ≈ 0.53  — same merchant
 *   "alspec windows" vs "alspec window"        ≈ 0.85  — same merchant
 *   "johnstones"     vs "johnstones paint"     ≈ 0.58  — same merchant (§3.2)
 *   "steels"         vs "ryan steels"          ≈ 0.54  — probably same (§3.2)
 *   "topps tiles"    vs "topps"                ≈ 0.45  — same merchant
 *   "lawsons"        vs "lionvest"             ≈ 0.07  — different
 *   "cad stairs"     vs "cabinets direct"      ≈ 0.05  — different
 *
 * LIKELY is set at 0.62 — above the near-identical spellings (a trailing
 * "Ltd", a plural, a typo) and below every genuinely-different pair. SUGGEST
 * at 0.34 is where "Topps" → "Topps Tiles" still gets offered but nothing
 * unrelated does. Below that, offering a candidate would train the owner to
 * skim past the question, which is the failure mode that matters.
 *
 * These are the *only* two magic numbers in the matcher, and they are one
 * edit away from being retuned if real invoices disagree.
 */
export const SUGGEST_THRESHOLD = 0.34;
export const LIKELY_THRESHOLD = 0.62;

function bandFor(score: number): MatchConfidence {
  if (score >= LIKELY_THRESHOLD) return "likely";
  if (score >= SUGGEST_THRESHOLD) return "possible";
  return "none";
}

// ============================================================
// Supplier resolution
// ============================================================

export interface SupplierCandidate {
  supplier_id: string;
  name: string;
  // Which spelling actually matched — the canonical name, or one of its
  // aliases. Shown on screen, because "matched the alias 'Lawson Timber'" is
  // a very different statement from "matched the name 'Lawsons'".
  matched_on: string;
  score: number;
  confidence: MatchConfidence;
  vat_number: string | null;
  is_unverified: boolean;
}

export interface SupplierDraft {
  name: string;
  vat_number: string | null;
  address: string | null;
  // Recorded on the row, so /suppliers can say where an unconfirmed merchant
  // came from instead of it just appearing.
  created_from_upload_id: string | null;
  is_unverified: true;
}

export interface SupplierResolution {
  // The raw text off the document, kept whatever happens. This becomes an
  // alias on save (see rawAlias in lib/purchaseWrite.ts) — that is how the
  // system stops asking the same question twice.
  raw_name: string | null;
  raw_vat_number: string | null;
  tier: MatchTier;
  confidence: MatchConfidence;
  // Pre-selected only when the tier justifies it. `null` means the review
  // screen shows the picker with nothing chosen.
  selected_supplier_id: string | null;
  candidates: SupplierCandidate[];
  // Filled in when nothing matched well enough — the review screen offers it
  // as "create this supplier" rather than pretending a match exists.
  draft: SupplierDraft | null;
  // Plain-English reasoning, shown on screen. Not logging.
  reason: string;
  // Set when the document's VAT number belongs to a *different* supplier from
  // the one the name matched. See the guard below — this is never resolved
  // automatically.
  vat_conflict: {
    vat_supplier_id: string;
    vat_supplier_name: string;
    name_supplier_id: string;
    name_supplier_name: string;
  } | null;
}

/** What a new supplier would be created as, from what the document said. */
export function newSupplierDraft(
  name: string | null,
  vatNumber: string | null,
  address: string | null,
  uploadId: string | null
): SupplierDraft | null {
  const clean = (name ?? "").trim();
  if (!clean) return null;
  return {
    name: clean,
    vat_number: vatNumber,
    address,
    created_from_upload_id: uploadId,
    // Always. A supplier the extractor invented has not been confirmed by
    // anybody, and /suppliers says so until someone edits it.
    is_unverified: true,
  };
}

type SupplierRow = Pick<
  Supplier,
  "id" | "name" | "vat_number" | "is_unverified"
>;

const SUPPLIER_COLUMNS = "id, name, vat_number, is_unverified";

/**
 * Resolve the supplier an extraction is about.
 *
 * No `.eq("user_id", …)` anywhere, here or in the RPC — RLS scopes every read
 * (about.md §9). The trigram RPC is `security invoker` for the same reason.
 */
export async function resolveSupplier(
  supabase: Client,
  opts: {
    name: string | null;
    vat_number: string | null;
    address: string | null;
    upload_id?: string | null;
  }
): Promise<SupplierResolution> {
  const rawName = opts.name?.trim() || null;
  const rawVat = normaliseVat(opts.vat_number);
  const uploadId = opts.upload_id ?? null;

  const base = {
    raw_name: rawName,
    raw_vat_number: opts.vat_number?.trim() || null,
    candidates: [] as SupplierCandidate[],
    draft: null as SupplierDraft | null,
    vat_conflict: null as SupplierResolution["vat_conflict"],
  };

  // ---- nothing to go on ----
  if (!rawName && !rawVat)
    return {
      ...base,
      tier: "none",
      confidence: "none",
      selected_supplier_id: null,
      reason:
        "No supplier name or VAT number could be read off the document — pick the merchant by hand.",
    };

  // ---- tier 1: VAT number, exact ----
  // Fetched as a small list rather than filtered in SQL so the comparison uses
  // exactly the same normaliser the browser does. The supplier table is tens
  // of rows in this app, not thousands.
  const { data: allSuppliers } = await supabase
    .from("suppliers")
    .select(SUPPLIER_COLUMNS);
  const suppliers = (allSuppliers ?? []) as SupplierRow[];

  const byVat = rawVat
    ? suppliers.find((s) => normaliseVat(s.vat_number) === rawVat) ?? null
    : null;

  // ---- tier 2: name or alias, exact on the normalised text ----
  const nameKey = rawName ? normaliseName(rawName) : "";
  let byName: SupplierRow | null =
    nameKey === ""
      ? null
      : suppliers.find((s) => normaliseName(s.name) === nameKey) ?? null;

  if (!byName && nameKey !== "") {
    const { data: aliases } = await supabase
      .from("supplier_aliases")
      .select("supplier_id, alias");
    const hit = ((aliases ?? []) as { supplier_id: string; alias: string }[]).find(
      (a) => normaliseName(a.alias) === nameKey
    );
    if (hit) byName = suppliers.find((s) => s.id === hit.supplier_id) ?? null;
  }

  const asCandidate = (
    row: SupplierRow,
    matched_on: string,
    score: number,
    confidence: MatchConfidence
  ): SupplierCandidate => ({
    supplier_id: row.id,
    name: row.name,
    matched_on,
    score,
    confidence,
    vat_number: row.vat_number,
    is_unverified: row.is_unverified,
  });

  // ---- the VAT override guard ----
  //
  // The document's VAT number says one merchant and its printed name says
  // another. This is not a tie to be broken: either two supplier records are
  // secretly the same company (and want merging), or one of them has the wrong
  // VAT number recorded. Both need a human, and picking the VAT match silently
  // would file the invoice against a merchant whose name is nowhere on it.
  if (byVat && byName && byVat.id !== byName.id)
    return {
      ...base,
      tier: "vat",
      confidence: "possible",
      // Deliberately not pre-selected.
      selected_supplier_id: null,
      candidates: [
        asCandidate(byVat, byVat.vat_number ?? "VAT number", 1, "certain"),
        asCandidate(byName, byName.name, 1, "certain"),
      ],
      vat_conflict: {
        vat_supplier_id: byVat.id,
        vat_supplier_name: byVat.name,
        name_supplier_id: byName.id,
        name_supplier_name: byName.name,
      },
      reason: `The VAT number on this invoice belongs to "${byVat.name}", but the printed name matches "${byName.name}". Those are recorded as two different merchants — pick the right one, or merge them first.`,
    };

  if (byVat)
    return {
      ...base,
      tier: "vat",
      confidence: "certain",
      selected_supplier_id: byVat.id,
      candidates: [asCandidate(byVat, byVat.vat_number ?? "VAT number", 1, "certain")],
      reason: `Matched on VAT number — this is "${byVat.name}".`,
    };

  if (byName)
    return {
      ...base,
      tier: "exact",
      confidence: "certain",
      selected_supplier_id: byName.id,
      candidates: [asCandidate(byName, byName.name, 1, "certain")],
      reason:
        normaliseName(byName.name) === nameKey
          ? `Matched "${byName.name}" exactly.`
          : `"${rawName}" is a known spelling of "${byName.name}".`,
    };

  // ---- tier 3: trigram, top five, never auto-accepted ----
  const { data: fuzzy, error: rpcError } = await supabase.rpc("match_suppliers", {
    q: rawName,
    match_limit: 5,
  });

  const rows = rpcError
    ? []
    : ((fuzzy ?? []) as {
        supplier_id: string;
        name: string;
        matched_on: string;
        score: number;
      }[]);

  const candidates: SupplierCandidate[] = rows
    .map((row) => {
      const held = suppliers.find((s) => s.id === row.supplier_id);
      return {
        supplier_id: row.supplier_id,
        name: row.name,
        matched_on: row.matched_on,
        score: Number(row.score),
        confidence: bandFor(Number(row.score)),
        vat_number: held?.vat_number ?? null,
        is_unverified: held?.is_unverified ?? false,
      };
    })
    .filter((c) => c.score >= SUGGEST_THRESHOLD);

  const draft = newSupplierDraft(rawName, rawVat, opts.address ?? null, uploadId);
  const top = candidates[0] ?? null;

  if (top && top.confidence === "likely")
    return {
      ...base,
      tier: "fuzzy",
      confidence: "likely",
      // Pre-selected, but the screen says so in amber and shows the score.
      selected_supplier_id: top.supplier_id,
      candidates,
      draft,
      reason: `Closest match is "${top.name}"${
        normaliseName(top.matched_on) === normaliseName(top.name)
          ? ""
          : ` (via the spelling "${top.matched_on}")`
      } — ${Math.round(top.score * 100)}% similar to "${rawName}". Confirm it, or create a new supplier.`,
    };

  if (top)
    return {
      ...base,
      tier: "fuzzy",
      confidence: "possible",
      // NOT pre-selected. A guess this weak has to be chosen deliberately.
      selected_supplier_id: null,
      candidates,
      draft,
      reason: `Nothing matched "${rawName}" closely. ${
        candidates.length === 1 ? "One merchant is" : `${candidates.length} merchants are`
      } vaguely similar — pick one only if you recognise it, otherwise create a new supplier.`,
    };

  return {
    ...base,
    tier: "none",
    confidence: "none",
    selected_supplier_id: null,
    draft,
    reason: rawName
      ? `"${rawName}" does not match any merchant on record. It will be created as a new supplier, marked unverified until you confirm it.`
      : "No supplier name could be read — pick the merchant by hand.",
  };
}

// ============================================================
// Item resolution — same three tiers, minus VAT
// ============================================================

export interface ItemCandidate {
  item_id: string;
  name: string;
  matched_on: string;
  score: number;
  confidence: MatchConfidence;
}

export interface ItemResolution {
  // The line's description, verbatim. Becomes purchase_lines.description_raw
  // whatever the match turns out to be — the document's own words are never
  // overwritten (about.md §4.6).
  raw_description: string;
  tier: MatchTier;
  confidence: MatchConfidence;
  selected_item_id: string | null;
  candidates: ItemCandidate[];
  reason: string;
}

/**
 * Resolve one line's item.
 *
 * Deliberately more relaxed than the supplier matcher in one respect and
 * stricter in another: there is no VAT-number equivalent for an item, so tier
 * 1 does not exist — but an unmatched item is *harmless*, because
 * lib/purchaseWrite.ts creates one from the description and every price
 * timeline starts somewhere. So `none` here is a normal outcome, not a
 * problem to flag.
 */
export async function resolveItem(
  supabase: Client,
  description: string
): Promise<ItemResolution> {
  const raw = description.trim();
  const key = normaliseName(raw);

  const base = {
    raw_description: raw,
    candidates: [] as ItemCandidate[],
  };

  if (!key)
    return {
      ...base,
      tier: "none",
      confidence: "none",
      selected_item_id: null,
      reason: "No description to match.",
    };

  // ---- exact, on the item name or any of its aliases ----
  const [{ data: items }, { data: aliases }] = await Promise.all([
    supabase.from("items").select("id, canonical_name"),
    supabase.from("item_aliases").select("item_id, alias"),
  ]);

  const itemRows = (items ?? []) as { id: string; canonical_name: string }[];
  const exact =
    itemRows.find((i) => normaliseName(i.canonical_name) === key) ??
    (() => {
      const hit = ((aliases ?? []) as { item_id: string; alias: string }[]).find(
        (a) => normaliseName(a.alias) === key
      );
      return hit ? itemRows.find((i) => i.id === hit.item_id) ?? null : null;
    })();

  if (exact)
    return {
      ...base,
      tier: "exact",
      confidence: "certain",
      selected_item_id: exact.id,
      candidates: [
        {
          item_id: exact.id,
          name: exact.canonical_name,
          matched_on: exact.canonical_name,
          score: 1,
          confidence: "certain",
        },
      ],
      reason: `Filed under "${exact.canonical_name}", so its price history continues.`,
    };

  // ---- trigram ----
  const { data: fuzzy, error: rpcError } = await supabase.rpc("match_items", {
    q: raw,
    match_limit: 5,
  });

  const candidates: ItemCandidate[] = (rpcError
    ? []
    : ((fuzzy ?? []) as {
        item_id: string;
        name: string;
        matched_on: string;
        score: number;
      }[]))
    .map((row) => ({
      item_id: row.item_id,
      name: row.name,
      matched_on: row.matched_on,
      score: Number(row.score),
      confidence: bandFor(Number(row.score)),
    }))
    .filter((c) => c.score >= SUGGEST_THRESHOLD);

  const top = candidates[0] ?? null;

  if (top && top.confidence === "likely")
    return {
      ...base,
      tier: "fuzzy",
      confidence: "likely",
      selected_item_id: top.item_id,
      candidates,
      reason: `Looks like "${top.name}" (${Math.round(
        top.score * 100
      )}% similar). Confirm it to keep one price history rather than two.`,
    };

  if (top)
    return {
      ...base,
      tier: "fuzzy",
      confidence: "possible",
      selected_item_id: null,
      candidates,
      reason: `Not sure what this is. If it is one of the items offered, say so — otherwise it becomes a new item.`,
    };

  return {
    ...base,
    tier: "none",
    confidence: "none",
    selected_item_id: null,
    reason: "New item — its price history starts with this invoice.",
  };
}

/** Resolve every line of a document in one pass. */
export async function resolveItems(
  supabase: Client,
  descriptions: string[]
): Promise<ItemResolution[]> {
  // Sequential on purpose. These are small queries against a small table, and
  // firing twenty concurrent RPCs at PostgREST to save a few milliseconds on a
  // screen the owner is about to read for a minute is not a trade worth making.
  const out: ItemResolution[] = [];
  for (const description of descriptions)
    out.push(await resolveItem(supabase, description));
  return out;
}

/** The provenance note /suppliers shows for a supplier the extractor invented. */
export function unverifiedNote(
  supplier: Pick<Supplier, "is_unverified" | "created_from_upload_id">,
  upload?: Pick<InvoiceUpload, "original_name"> | null
): string | null {
  if (!supplier.is_unverified) return null;
  const from = upload?.original_name ? ` from ${upload.original_name}` : "";
  return `Created automatically when an invoice${from} was read, and not confirmed since. Check the name and VAT number.`;
}
