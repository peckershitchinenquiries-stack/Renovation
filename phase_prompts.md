# Claude Code prompts — RenovaTrack Route C, Phases 0 / 1 / 3

Ready-to-paste prompts, derived from `renovatrack_evolution_summary.md`.
Run them in order, in **separate Claude Code sessions**, and only start the next
one when the previous one's migration has actually been run in the Supabase SQL
editor and the screens still look right.

Phases 2, 4 and 5 are deliberately not covered here.

**Sequencing note.** Phase 1 depends on Phase 0's tables being populated.
Phase 3 depends on both (it commits into the Phase 0 tables and links out to the
Phase 1 pages). Migration numbers assume Phase 0 takes `0008` and Phase 3 takes
`0009` — if that changes, adjust the later prompt before pasting it.

**Status.** `0007` was run on 2026-08-14, and **Phase 0 has since been built** —
see `supabase/migrations/0008_transaction_core.sql` and the `updates.md` entry
for that date. The Phase 0 brief below is kept as the record of what was asked
for. Phase 1 is the next one to paste; its opening line already tells Claude to
check that `purchases` has rows before building on it.

---

## Phase 0 — Transaction core: schema + migration (Glenferrie)

```
Read CLAUDE.md, then about.md in full, then the last two entries of updates.md, then
renovatrack_evolution_summary.md (sections "Recommended Solution: Route C" and
"Phase 0"). Do not re-derive the current schema from the code — about.md documents it.

GOAL
Add the Route C transaction core alongside the existing schema, and backfill it from
expense_entries, without changing a single screen. When you are done the app must look
and behave exactly as it does now, and every current figure in about.md §13 must be
unchanged.

BUILD

1. Migration `supabase/migrations/0008_transaction_core.sql`, containing:

   New tables (all in schema public, all with `user_id uuid not null references
   auth.users(id) on delete cascade`, all with RLS enabled and the project's one-policy
   pattern `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`):

     suppliers         id, user_id, name, type, account_ref, notes, timestamps
                       unique (user_id, lower(name))
     supplier_aliases  id, user_id, supplier_id, alias, unique (user_id, lower(alias))
     items             id, user_id, canonical_name, category, default_unit,
                       pack_size, pack_unit, timestamps
                       unique (user_id, lower(canonical_name))
     item_aliases      id, user_id, item_id, alias, unique (user_id, lower(alias))
     purchases         id, user_id, project_id, supplier_id (nullable),
                       purchase_date (date, nullable), week_no, invoice_no, category,
                       net_total, vat_total, gross_total, origin, entry_source,
                       source_file_id (nullable text), legacy_entry_id (uuid, unique),
                       timestamps
     purchase_lines    id, user_id, purchase_id, item_id (nullable), description_raw,
                       qty, unit, unit_price, line_net, vat_rate, line_no, timestamps
     payments          id, user_id, purchase_id, paid_on (date, nullable), amount,
                       method, reference, timestamps
     receipts          id, user_id, purchase_id, storage_path, uploaded_at

   CHECK constraints, matching the existing style (reject, don't coerce):
     purchases.category      Labour | Materials | Skip/Disposal | Other | null
     purchases.origin        manual | excel | text | invoice_ocr | legacy_import
     purchases.entry_source  diary | ledger
     purchase_lines.vat_rate 0 or 20
     payments.method         Cash | Debit Card | Credit Card | Bank Transfer | null
     all money columns >= 0, qty >= 0

   Indexes: purchases(project_id), purchases(supplier_id), purchases(user_id),
   purchases(purchase_date), purchase_lines(purchase_id), purchase_lines(item_id),
   payments(purchase_id), plus the alias lookup indexes on lower(alias).

   `updated_at` triggers reusing public.set_updated_at() where the table has one.

2. `entry_source` is not optional and not cosmetic. about.md §5 is the biggest trap in
   this project: expense_entries.source splits the app in two and diary + ledger rows
   overlap, so summing them double-counts. Carry that distinction onto purchases so the
   new tables can never lose it. `origin` (where the data came from) and `entry_source`
   (which half of the app it belongs to) are different things — do not merge them.

3. Backfill, in the same migration, inside one transaction:

   - One `purchase` per expense_entries row, with `legacy_entry_id = expense_entries.id`
     so the migration is re-runnable (delete prior backfill by legacy_entry_id first,
     or upsert on it) and so the compatibility view can join back.
   - Exactly one `purchase_line` per purchase, carrying description_raw = the entry's
     description verbatim, plus qty, unit_cost → unit_price, vat_rate.
   - One `payments` row per entry where paid_amount > 0, with paid_on = paid_date
     (which is frequently null — allow it) and method = payment_method.

   Money mapping — get this right, it has been got wrong before (about.md §2, §3.1):
     actual_amount is EX-VAT          → purchases.net_total, purchase_lines.line_net
     vat_total  = actual_amount * vat_rate / 100
     gross_total = net_total + vat_total   (this equals computeEntry's total_incl_vat)
     paid_amount is INCL-VAT           → payments.amount, unchanged
     quoted_amount is INCL-VAT for the Glenferrie import — do NOT fold it into
     net/vat/gross. If you want to keep it, add a nullable `quoted_gross` column on
     purchases and say so; otherwise leave it out and note the loss.
   Do not create a stored balance or status column anywhere. Balance is
   gross_total − sum(payments.amount) and status derives from it, always computed.

4. Seed suppliers and items from what already exists:
   - suppliers: distinct non-null expense_entries.supplier, plus distinct non-null
     trade values that are clearly merchants. Where you cannot tell, create the
     supplier from `supplier` only, leave purchases.supplier_id null for the rest, and
     print a count of unlinked purchases at the end.
   - items: distinct normalised description, using the same normalisation as
     priceKey() in lib/summary.ts (trim, lower-case, collapse internal whitespace) so
     the new items table and the existing Price Tracker agree on what one item is.
   - Write the original text as the first alias row for every supplier and item created.
   - Do not attempt fuzzy merging here ("Lawson" vs "Lawsons"). Seed literally; the
     alias-merge tooling is Phase 3's job. Say so in the output.

5. Backwards-compatible view `expenses_view`, shaped exactly like expense_entries
   (same column names and types) but sourced from purchases + purchase_lines + payments.
   Create it `with (security_invoker = true)` — a plain Postgres view runs with the
   owner's rights and would bypass RLS, which in this project is the only thing scoping
   data to a user. Nothing has to consume the view yet; it exists so the switchover in a
   later phase is reversible.

6. Self-check before commit, in the style of 0007: raise an exception and roll back
   unless, for the diary rows,
     sum(purchases.gross_total)  = sum over expense_entries of actual*(1+vat/100)
     sum(payments.amount)        = sum(expense_entries.paid_amount)
     count(purchases)            = count(expense_entries)
     count(purchase_lines)       = count(expense_entries)
   to within a penny, and the same for ledger rows separately. Then print a report:
   row counts per table, diary vs ledger gross totals, paid total, suppliers created,
   items created, purchases with a null supplier_id.

7. Types in types/index.ts: Supplier, SupplierAlias, Item, ItemAlias, Purchase,
   PurchaseLine, Payment, Receipt, plus PurchaseComputed (paid, balance, status:
   'Paid' | 'Partial' | 'Pending'). Add a `computePurchase` / `computePurchases` pair in
   a new lib/purchases.ts mirroring how lib/calculations.ts works — derived on read,
   never stored. Use the same 0.001 rounding tolerance buildTrades uses so the two
   agree on what "settled" means.

DO NOT
- Change any existing table, screen, component, API route, lib/summary.ts function or
  lib/calculations.ts formula. Phase 0 is additive only.
- Add .eq("user_id", …) anywhere. RLS scopes everything; see about.md §9.
- Run the migration — you cannot. Migrations here are pasted into the Supabase SQL
  editor by hand.

VERIFY
- npm run build passes (it is the project's only full typecheck).
- python scripts/verify_against_spreadsheet.py still passes, unchanged.
- Show me the SQL for the self-check block and the report, and tell me explicitly that
  0008 has NOT been run and must be pasted into the Supabase SQL editor.

FINALLY
- Update about.md: new §4.6 describing the seven new tables and the view, a note in §5
  that entry_source carries the diary/ledger split forward, and 0008 added to the §12
  table marked "not yet run".
- Add an updates.md entry using the template at the top of that file — plain English,
  files used, files changed, migration written and whether it has been run, and the fact
  that no headline figure in §13 should move.

ASK ME FIRST if the seeding pass would create more than ~150 suppliers, if you find
expense rows whose supplier and trade both look like merchant names, or if you think
quoted_amount needs to survive onto purchases.
```

---

## Phase 1 — Supplier & item pages (read-only)

```
Read CLAUDE.md, about.md (§4.6 and §6 especially), the last two updates.md entries, and
the "Phase 1" section of renovatrack_evolution_summary.md. Phase 0 (migration 0008) is
already applied — confirm by checking that purchases and purchase_lines have rows before
you build anything on them, and stop and tell me if they are empty.

GOAL
Read-only supplier and item pages, so "when did I last buy sand from Lawson, and what did
it cost?" is one click. No writes, no forms, no new mutations.

BUILD

1. Data loaders in lib/data.ts, server-side, following getProjectBundle's shape
   (one pass, no per-row queries, no user_id filter — RLS handles it):

   getSuppliers()            → suppliers with purchase count, gross total, outstanding
                               balance, last purchase date
   getSupplierBundle(id)     → supplier + its purchases (with lines and payments nested)
   getItems()                → items with purchase-line count, latest unit price,
                               distinct supplier count, latest delta
   getItemBundle(id)         → item + every purchase_line referencing it, joined back to
                               its purchase for date, supplier, invoice and project

2. Derived figures in lib/purchases.ts (extend what Phase 0 added — do not duplicate
   logic that already exists in lib/summary.ts):
     balance  = gross_total − Σ payments.amount        (computed, never stored)
     status   = Paid if balance <= 0.001 and paid > 0; Partial if paid > 0; else Pending
   Use the same 0.001 tolerance and formatCurrency (en-GB, GBP) the rest of the app uses.

3. Pages under app/(app)/, async Server Components, using createClient() from
   lib/supabase/server.ts:

   /suppliers          list: name, purchases, total spend, outstanding, last purchase
   /suppliers/[id]     header cards (total spend, paid, outstanding, purchase count),
                       then purchases newest first — date, invoice no, project, lines,
                       gross, paid, balance, status badge, payment dates + methods, and a
                       running total column. Each purchase expands to show its lines
                       (description_raw, item link, qty, unit, unit price, line net).
   /items              list: canonical name, category, default unit, times bought,
                       suppliers, latest unit price, trend
   /items/[id]         price timeline oldest → newest across every supplier and project:
                       date, supplier, project, qty, unit, unit price, line net, invoice,
                       and the % change vs the previous purchase.

   Reuse the existing UI vocabulary: StatCard, Badge, and the States components for empty
   and loading. Add loading.tsx files matching the existing ones.

4. Unit handling on the item timeline — this is the point of the whole feature, so get it
   right (evolution summary, "Unit handling"):
     same item, same unit      → show the % delta, coloured up/down like PricesTab does
     same item, different unit → do NOT show a %; show "bag → tonne — check pack size"
   Never compute a percentage across two different units. An alert that lies once gets
   ignored forever.

5. Nav: add Suppliers and Items to the array in components/ui/AppNav.tsx. Both TopNav and
   MobileNav read the same array, so one edit covers both — check that isActive() does the
   right thing for /suppliers/[id].

6. Every table renders twice — a `sm:hidden` card list and a `hidden sm:block` table from
   the same array (about.md §8). If you add a column, add it to both, or it is invisible
   on a phone.

DO NOT
- Add any create/edit/delete affordance. Phase 2 owns writes.
- Touch expense_entries, lib/summary.ts, or any of the five existing project tabs.
- Sum diary and ledger purchases into one "project total" anywhere. Supplier and item
  pages are cross-project by design, so label the totals honestly ("across all purchase
  records") and, where a figure would be misleading because of the diary/ledger overlap
  (about.md §5), either split it by entry_source or leave it out.

VERIFY
- npm run build passes.
- Start the dev server, open /suppliers, pick the supplier with the most purchases, and
  screenshot it. Same for the item with the most purchase lines. Check the balance on one
  supplier by hand against gross_total − payments and show me the arithmetic.
- Check both pages at mobile width.

FINALLY
- about.md: new subsections under §8 for the four routes, and a §7 entry for any new
  derived function.
- updates.md entry using the template. Note that no database change was needed.
```

---

## Phase 3 — Excel/CSV import + review screen

```
Read CLAUDE.md, about.md, the last two updates.md entries, and the "Data Ingestion
Pipeline" and "Phase 3" sections of renovatrack_evolution_summary.md. Phases 0 and 1 are
already applied. scripts/build_import_sql.py is the closest thing to prior art for
parsing these spreadsheets — read it before writing a parser.

GOAL
Bulk-import a spreadsheet into purchases + purchase_lines through a review screen where
nothing saves until I accept it, row by row. Every correction I make teaches the system an
alias, so it never asks the same question twice.

BUILD

1. Migration `supabase/migrations/0009_import_staging.sql` — same RLS pattern, same
   user_id cascade, same CHECK-constraint style as everything else:

     import_batches  id, user_id, project_id, filename, sheet_name, entry_source
                     (diary|ledger, default diary), status (parsing|review|committed|
                     abandoned), column_map jsonb, row_count, created_at, committed_at
     import_rows     id, user_id, batch_id, row_no, raw jsonb (the original row, verbatim
                     and forever), parsed jsonb (the proposal), supplier_id, item_id,
                     supplier_confidence, item_confidence, match_tier
                     (exact|fuzzy|none), issues text[], status
                     (pending|accepted|rejected|committed), created_at, updated_at

   raw is never edited. It is what the document said, and it is how a bad mapping gets
   re-done later without re-uploading.

2. Upload + parse: POST /api/imports takes an .xlsx or .csv, parses it server-side with
   the `xlsx` package (already a dependency — do not add another), and creates a batch
   plus one import_row per data row. Route Handlers call requireUser() from lib/api.ts
   first and return the { response } branch early (about.md §3). Cap the file size and
   reject anything that is not xlsx/csv by content, not just extension.

   Do not store the uploaded file in Supabase Storage in this phase — raw jsonb per row
   is enough, and it avoids a new bucket and three new storage policies.

3. Column mapping step: show the sheet's headers and let me map them to
   supplier / date / invoice no / description / qty / unit / unit price / line net /
   vat rate / category / week. Guess the mapping from the header text, let me override,
   store the result in import_batches.column_map. Group rows that share supplier + date +
   invoice no into one proposed purchase with N lines — that is the whole point of Route C
   and a flat one-row-per-line import throws it away.

4. Matching engine in a new lib/matching.ts, pure functions, no new dependencies:
     exact alias hit (normalised)     → auto-accept silently, tier 'exact'
     similarity >= threshold          → pre-fill, flag for confirmation, tier 'fuzzy'
     otherwise                        → propose creating a new supplier/item, tier 'none'
   Normalise with the same rule priceKey() uses in lib/summary.ts (trim, lower-case,
   collapse whitespace) so matching, the Price Tracker and the Phase 0 seeding all agree.
   Implement similarity as trigram or token-set Jaccard; put the threshold in one named
   constant with a comment, and tell me what you set it to and why.

5. Arithmetic validation on parse, per the evolution summary — invoices carry their own
   checksum:
     |qty × unit_price − line_net| > 0.01                  → issue on the row
     Σ line_net of a proposed purchase ≠ its stated total  → issue on the purchase
     vat_rate not 0 or 20                                  → issue (the DB will reject it)
     date unparseable                                      → issue, keep the raw text
   Rows with issues can still be accepted after I fix them, but they cannot be
   bulk-accepted.

6. Review screen at /projects/[id]/import (client component, mutating through apiFetch
   from lib/fetcher.ts):
     - original row on the left, verbatim; parsed proposal on the right, editable
     - match tier shown per field: silent for exact, amber for fuzzy with the matched
       name and score, red for "new supplier/item will be created"
     - per row: Accept / Correct / Reject. Plus "accept all exact matches with no issues"
       — and nothing else bulk-accepts.
     - a sticky summary: N accepted, N pending, N rejected, N with issues, proposed
       purchase count, proposed gross total
     - correcting a supplier or item writes a new alias on accept, so the same spelling is
       never asked about again. Show that it happened.
     - responsive: card list under `sm`, table above, like every other table in this app.

7. Commit: POST /api/imports/[id]/commit writes accepted rows into purchases,
   purchase_lines and payments, marks the batch committed, and is idempotent — committing
   twice must not double-insert. Do this in a Postgres function called via supabase.rpc so
   it is one transaction; a Route Handler issuing several inserts is not atomic and a
   half-committed import is exactly the mess this phase exists to prevent. Keep the
   function security invoker so RLS still applies.

   Set purchases.origin = 'excel', purchases.entry_source from the batch, and
   purchases.source_file_id = the batch id, so an import is traceable and reversible.

8. Link the committed purchases into the Phase 1 pages: after commit, show a summary with
   links to the suppliers and items touched.

DO NOT
- Auto-save anything. A row that has not been accepted must never reach purchases.
- Write into expense_entries. The new tables are the target now.
- Import into 46 Glenferrie Road by default — default the project picker to unset and make
  me choose. That project's data came from 0007 and must not be duplicated by an import.
- Guess a supplier or item silently below the threshold.

VERIFY
- npm run build passes.
- Test against a real file: use Renovation_Cost_Tracker-1.xlsx, sheet "Materials &
  Suppliers". Import it into a scratch project — not Glenferrie — and show me:
  screenshots of the mapping step and the review screen, the tier breakdown
  (exact/fuzzy/none counts), every row that raised an arithmetic issue, and the committed
  purchase and line counts against the sheet's row count.
- Prove idempotency by calling commit twice and showing the row counts are unchanged.
- Then delete the scratch project and tell me you have.

FINALLY
- about.md: §4 entries for the two staging tables, a new section for the ingestion
  pipeline and the matching thresholds, the new routes in §8, and 0009 in §12.
- updates.md entry using the template, including whether 0009 has been run.

ASK ME FIRST about the fuzzy threshold if your test run shows more than ~20% of rows
landing in the 'fuzzy' tier, and before adding any dependency.
```

---

## What each phase leaves you with

| Phase | Migration | Outcome |
|---|---|---|
| 0 | `0008_transaction_core.sql` | Glenferrie data in the new shape, every existing screen untouched and every §13 figure unmoved |
| 1 | none | `/suppliers` and `/items` — supplier statements and cross-project price timelines |
| 3 | `0009_import_staging.sql` | Spreadsheets bulk-import through a review screen; aliases learned per correction |

Phase 2 (multi-line manual entry) is skipped for now, which means until it lands the only
way to create a multi-line purchase is the Phase 3 importer. That is deliberate and worth
remembering — it is why Phase 3's review screen carries the whole weight of data entry.
