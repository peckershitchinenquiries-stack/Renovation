# about.md — RenovaTrack reference

**Read this before changing anything in this project.**



Last verified: 2026-08-17, against migrations 0001–0009. `0009` has been
regenerated and **not yet run** — see §12.

---

## 1. What this is

RenovaTrack — a renovation cost tracker for **46 Glenferrie Road, St Albans,
AL1 4JU**. It replaces the week-by-week spreadsheet the owner was keeping by
hand.

- **Next.js 14** (App Router) · **TypeScript** · **Tailwind** · **Supabase**
  (Postgres + Auth + Storage).
- **Single user in practice** — `admin@pk.com`. Public sign-up is disabled;
  users are created by hand in the Supabase dashboard.
- One real project row exists: `46 Glenferrie Road`.

### Commands

```bash
npm run dev     # dev server on :3000
npm run build   # production build — also the only full typecheck
npm run lint    # next lint
npx tsc --noEmit  # faster typecheck-only pass
```

There is **no test suite**. `npm run build` (or `npx tsc --noEmit`) is the
verification step — run it after any non-trivial change.

### Migrations are applied by hand

There is no migration CLI. Each file in `supabase/migrations/` is pasted into
the **Supabase SQL editor** and run manually, in filename order. Writing a
migration file does not apply it. Always tell the user to run it.

---

## 2. Five rules that will bite you

1. **Never persist a computed total.** `total_incl_vat` is not a column. It is
   derived on every read by `computeEntry`. Same for `subtotal`, `vat_amount`,
   `materials_cost`, `remaining`. The corollary: **`actual_amount` is ex-VAT.**
   Writing an incl-VAT figure into it applies VAT twice. That is exactly what
   went wrong in `0005` — see §3.1.
2. **`ledger` is now an empty half of the app.** Since `0009` (2026-08-14) every
   row is `diary`. The `source` column, the CHECK constraint and every filter
   that uses it all remain — the mechanism is intact and still correct, there
   is simply nothing on the other side of it. Do not sum the two anyway. See §5.
3. **Never add `.eq("user_id", …)` to a query.** RLS does the scoping. But
   a new table with no RLS policy returns nothing — or leaks everything if RLS
   is left disabled.
4. **CHECK constraints reject, they don't coerce.** A `vat_rate` of 5 fails the
   insert outright. Match the allowed value lists in §4 exactly.
5. **`on delete cascade` on every `user_id`.** Deleting an auth user destroys
   all their data. This has already happened once — see §11.

---

## 3. Where data comes from and how it flows

```
One spreadsheet (repo root)           scripts/build_import_sql.py
  46_Glenferrie_Rd_..._Updated.xlsx  ──────────┐
    "Week-by-Week Plan"  → 111 diary rows      │
    "Lookups"            → 16 trade lookups    │
                                               ▼
                       supabase/migrations/0009_reimport_file1_only.sql
                                               │  (pasted into SQL editor)
                                               ▼
                                    Supabase Postgres
                                               │
                      ┌────────────────────────┴───────────────────────┐
                      ▼                                                 ▼
      Server Components read directly              Client Components mutate
      lib/data.ts → getProjectBundle()             lib/fetcher.ts → apiFetch()
      (createClient from lib/supabase/server)      → app/api/**/route.ts
                      │                                                 │
                      └────────────────► lib/calculations.ts ◄──────────┘
                                         lib/summary.ts
                                         (all the maths lives here)
```

**Two directions, know which you are in:**

- **Reads** — Server Components call Supabase directly. `getProjectBundle()`
  in `lib/data.ts` fetches project + entries + trade lookups + weeks in one
  pass and returns entries already run through `computeEntries`.
- **Writes** — Client Components go through Route Handlers in `app/api/`.
  Each handler calls `requireUser()` from `lib/api.ts`, which returns either
  `{user, supabase}` or `{response}`. **The caller must check for `response`
  and return it early** — that is the 401 path.

### The source spreadsheet

**`46_Glenferrie_Rd_Renovation_Spend_Tracker_Updated.xlsx` is the only file
imported.** It is the **source of truth** for rebuilds. Do not delete it.

| | |
|---|---|
| Sheets | `Week-by-Week Plan`, `Summary`, `Lookups` |
| Becomes | 111 `diary` rows, weeks 1–23, + 16 trade lookups |
| Totals | ex-VAT £141,686.89 / incl-VAT £151,644.78 |

`..._Blank_Template.xlsx` is the older weeks 1–15 version, superseded by
`..._Updated.xlsx` on 2026-08-06 and kept only for history.

### 3.0 `Renovation_Cost_Tracker-1.xlsx` is a *different job* — do not re-import it

Until `0009` (2026-08-14) this second workbook was imported as 96 `ledger` rows
and its total became the project's `target_budget`. It was never this project's
spend. Four independent things say so:

| | `..._Updated.xlsx` | `Renovation_Cost_Tracker-1.xlsx` |
|---|---|---|
| Address stated | 46 Glenferrie Road, on both sheets | **none anywhere** |
| Date range | 2026-02-27 → ongoing | 2025-11-02 → **2026-01-25** |
| Proportion paid | £13,273 of £151,645 | £98,932 of £98,932 — **100%** |
| First / last work | week 1 "clearance / back to brick" | ends carpets, **staging**, driveway clean |

The date ranges **do not overlap by a single day** — the second workbook stops a
month before this project's week 1 — and it ends with a house being dressed for
sale while this one *begins* by stripping back to brick. The shared supplier
names (Lawsons, Alspec, Eurocell, Wunda, Johnstones) are the same trades used
again on the next job, which is exactly what let it contaminate the
string-matched Price Tracker (§6.8).

**It also broke the Price Tracker outright.** Its `Materials & Suppliers` sheet
is a *payment log*, not a price list: `Item` is empty on all 60 rows, `Quantity`
is `1` on all 60, and `Unit Cost (£)` holds **the amount of that payment**. The
import copied that into `unit_cost`, so instalments read as unit prices:

```
wunda ufh       2x  416.05 (deposit), 3586.00 (balance)  →  +761.9%
plumbing        7x  1000, 1000, 3000, 1000, 1500, 500, 1000  →  +100.0%
alspec windows  4x  5000, 2500, 1000, 1500               →   +50.0%
eurocell        2x  650, 50                              →   -92.3%
```

Eleven suppliers did this. Since the diary records no unit costs at all
(`Qty` and `Unit Cost` are empty on all 111 rows), **100% of the Price Tracker's
content was instalment payments misread as prices.**

The workbook stays in the repo as history. `build_import_sql.py` no longer opens
it, and `verify_against_spreadsheet.py` now **fails** if any `ledger` row
reappears.

### 3.1 How spreadsheet money becomes database money

This is the single easiest thing to get wrong, and it has been got wrong once.
The app derives `total_incl_vat = actual_amount × (1 + vat_rate/100)` on every
read (§6.1). So **`actual_amount` must hold the ex-VAT figure.** The pre-2026-08-06
import stored the sheet's *Total incl. VAT* column in `actual_amount` *and* set
`vat_rate` to 20, so VAT was applied twice and the Overview read £43,686.17
where the spreadsheet said £42,411.81.

| DB column | Week-by-Week Plan column |
|---|---|
| `actual_amount` | `Labour Cost (£)` **+** `Materials Cost (£)` — ex-VAT |
| `vat_rate` | `VAT` — `'0%'` → 0, `'20%'` → 20 |
| `quoted_amount` | `Total incl. VAT (£)` |
| `paid_amount` | `Total incl. VAT (£)`, but only when `Paid Date` is filled |
| `status` | `Paid` when `Paid Date` is filled, else the sheet's `Status` |
| `supplier` | **`Task / Description`, on `Materials` rows only** — *not* the `Supplier` column. See §3.2 |

Two of those need justifying:

- **`quoted_amount` gets the incl-VAT total** because the Week-by-Week Plan has
  no quote column — the sheet's forecast *is* its quote. This makes the
  Overview `Total Quoted` card equal the sheet's `Forecast Total (incl. VAT)`
  and leaves `Variance vs Quote` at £0.00, which is honest: nothing here was
  ever separately quoted.
- **`paid_amount` gets the incl-VAT total** because that is the sum actually
  handed over. It makes `Paid to Date` and `Remaining to Pay` equal the sheet's
  own `Paid to date` and `Committed` figures exactly.

**Spreadsheet quirks you must know:**

- The `Status` column reads `Planned` on **all 111 rows**. It carries no payment
  information. The real payment marker is the **`Paid Date`** column.
- Paid dates are hand-typed free text: `Friday 27/2`, and once `FRIDAY 10/4`.
  Day/month, weekday name, no year. `resolve_written_date()` in
  `build_import_sql.py` picks the year by matching the weekday — all seven
  distinct dates land on the stated weekday only in **2026**.
- Rows with a paid date: 20 (weeks 1–7). Rows without: 91 (weeks 8–23).
- `Qty (Materials)` and `Unit Cost (£)` are **empty on every row**. The Price
  Tracker therefore sees nothing at all and shows its "No price history yet"
  empty state. It fills up as unit costs are typed into new expenses — see §6.8.
- **Weeks 20–23 have every cost typed into `Materials Cost`**, whatever the row's
  `Category` says. This is why `parse_diary()` *adds* the labour and materials
  columns instead of picking one. It also means the sheet's own `Summary` tab
  reports £0 labour for those weeks while the app, which splits on `Category`,
  reports the real figure. Week totals are unaffected — see §6.4.
- The `VAT` column is text (`'0%'`) in the updated file and was a number (`0`)
  in the old one. `vat_of()` strips the `%` and handles both.
- **The `Supplier` column is not where the suppliers are.** See §3.2.

### 3.2 The merchant names are in the *Description* column

The sheet's `Supplier` column (index 6) has **8 non-empty cells in 111 rows**,
and only one of them — `Stevenage Skips` — is a merchant. The other seven are
sentences typed into the wrong column. The merchant names were being typed into
`Task / Description` instead, on the `Materials` rows:

| Sheet row | Week | `Task / Description` | Category |
|---|---|---|---|
| 62 | 5 | `Master Mix` | Materials |
| 190 | 15 | `Lawsons` | Materials |
| 205 | 16 | `Alspec Windows` | Materials |
| … | | 45 Materials rows, **32 distinct merchants** | |

Confirmed by the owner on 2026-08-17, who supplied the list of real suppliers —
it turned out to be *exactly* the set of distinct Materials descriptions, with
nothing extra on either side. So the import reads `supplier` from there.

**The rule, in `scripts/build_import_sql.py` (`supplier_of`):**

1. A `Supplier` cell naming a **known merchant** wins — that is the column meant
   for it. Only `Stevenage Skips` (row 59, a Labour row) qualifies.
2. Otherwise, a **`Materials`** row takes its merchant from its description,
   looked up in `SUPPLIER_NAMES`.
3. Any other non-empty `Supplier` cell is a **note** and is moved into `notes`,
   verbatim — exactly what re-typing it into `Dependencies/Notes` on the sheet
   would have produced. Seven rows, listed in §13.
4. **Labour rows get no supplier.** `Dave Builder`, `Owen Brickwork`,
   `Nick Loft`, `Labourers` and the rest are people and subcontractors, not
   merchants. 65 of the 111 rows have `supplier = null` and that is correct.

> ⚠️ **`SUPPLIER_NAMES` is a declared list, not a heuristic — and there is a
> guard that keeps it that way.** `check_suppliers()` **aborts the import** if
> the distinct Materials descriptions and the list ever stop matching in either
> direction. Add a Materials row for a new merchant and the script stops and
> tells you to add the name (after checking with the owner) rather than
> silently importing a row with no supplier. Nothing anywhere guesses which
> strings "look like" a merchant; that is the property that keeps the import
> verifiable against its source.

Two pairs are kept as the owner wrote them even though each is probably one
merchant: **`Johnstones` / `Johnstones Paint`** and **`Steels` / `Ryan Steels`**.
Merging near-duplicates is the alias work in §4.6, where a human confirms each
one — the importer does not decide it.

The name key is `name_key()`, the same trim / lower-case / collapse-whitespace
rule as `public.norm_key()`, `priceKey()` and `normaliseName()` (§4.6). That is
what lets the sheet's `CAD Stairs ` and `Saris ` — both carrying a trailing
space — resolve to one canonical merchant each.

---

## 4. Tables

There are **four application tables**, all in schema `public`. Defined in
`supabase/migrations/0001_init.sql`, amended by `0002` and `0003`.

### 4.1 `projects`

One row per renovation project.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid | → `auth.users(id)` **on delete cascade** |
| `name` | text | required |
| `target_budget` | numeric(12,2) | default 0. See §6 for where the value came from |
| `status` | text | `active` \| `completed` \| `paused` |
| `notes` | text | |
| `created_at` / `updated_at` | timestamptz | `updated_at` maintained by trigger `trg_projects_updated` |

Dropped by `0002`: `address`, `start_date`, `end_date`, `contingency_pct` —
the owner does not track them.

### 4.2 `expense_entries`

**The central table.** Every cost line, both diary and ledger.

| Column | Type | Allowed values / notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | → `auth.users(id)` **cascade** |
| `project_id` | uuid | → `projects(id)` **cascade** |
| `week_number` | integer | `> 0` |
| `description` | text | required. Also the price-tracking key (lower-cased) |
| `category` | text | `Labour` \| `Materials` \| `Skip/Disposal` \| `Other` \| null |
| `trade` | text | free text; matched against `trade_lookups.name` by convention only — **no FK** |
| `location_room` | text | |
| `notes` | text | pipe-joined segments, e.g. `Rubbish Removal \| Rate: 45.0` |
| `supplier` | text | groups the Materials tab |
| `invoice_ref` | text | |
| `paid_date` | **date** | a real date column — free text cannot go here |
| `payment_method` | text | `Cash` \| `Debit Card` \| `Credit Card` \| `Bank Transfer` \| null |
| `quoted_amount` | numeric(12,2) | ≥ 0. What was quoted, **ex-VAT** |
| `actual_amount` | numeric(12,2) | ≥ 0. What it really cost, **ex-VAT** |
| `paid_amount` | numeric(12,2) | ≥ 0. What has been handed over, **ex-VAT** |
| `qty` | numeric(10,2) | ≥ 0. Materials only |
| `unit_cost` | numeric(12,2) | ≥ 0. Materials only — drives the Price Tracker |
| `vat_rate` | numeric(5,2) | **exactly `0` or `20`** |
| `status` | text | `Planned` \| `In Progress` \| `Paid` \| `Cancelled` |
| `source` | text | `diary` \| `ledger`, default `diary` — see §5 |
| `receipt_url` | text | path in the private `receipts` storage bucket |
| `created_at` / `updated_at` | timestamptz | trigger `trg_expense_updated` |

Added by `0002`: `quoted_amount`, `actual_amount`, `paid_amount`.
Dropped by `0002`: `hours`, `labour_rate`, `direct_labour_cost` — the old
hours × rate model. Surviving rate info now lives in `notes` as `Rate: 45.0`.
Added by `0003`: `source`.

**Indexes:** `project_id`, `user_id`, `(project_id, week_number)`, `status`,
and `(project_id, lower(description))` for price lookups.

### 4.3 `trade_lookups`

Default hourly rates per trade. Reference data only — nothing joins to it.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | cascade |
| `name` | text | `unique (user_id, name)` |
| `default_rate` | numeric(8,2) | £/hr |
| `default_markup_pct` | numeric(5,2) | |

**Auto-seeded.** Trigger `trg_seed_trades` fires `after insert on auth.users`
and inserts 13 default trades (General Builder 45, Plumber 60, Electrician 65,
…). This is why a freshly recreated account appears to "have data" when in fact
everything else was destroyed — see §11.

### 4.4 `project_weeks`

Optional per-week completion tracking. **No longer editable from the UI** — the
Completion % column was removed from the Overview tab on 2026-08-05 because it
was hand-typed and fed nothing else. The table, its API route and
`WeekTotal.completion_pct` all still exist and still round-trip; nothing
displays them.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` / `project_id` | uuid | cascade |
| `week_number` | integer | `unique (project_id, week_number)` |
| `completion_pct` | numeric(5,2) | `between 0 and 100` |
| `notes` | text | |

### 4.5 Storage

Private bucket `receipts`. Objects are namespaced by user:
`{auth.uid()}/…`, enforced by three `storage.objects` policies (read / write /
delete). `createServiceClient()` (service-role key) exists **only** for MIME
validation and signed URLs — never expose it to the client.

### 4.6 The transaction core — eight more tables

Added by `0008_transaction_core.sql` (Route C, Phase 0), **run 2026-08-14**.
They sit **alongside** the four tables above, which are untouched and still feed
every project screen. The only things reading them are the Phase 1 supplier and
item pages — see §8.1.

Why they exist: `expense_entries` flattens the document and the item into one
row, and the purchase and the payment into one row. That is what makes
multi-line invoices impossible, supplier grouping unreliable string matching,
and "what did I owe Lawson on 14 Aug?" unanswerable.

| Table | Scope | Holds |
|---|---|---|
| `suppliers` | above the project | one row per merchant — `name`, `type`, `account_ref`, `notes` |
| `supplier_aliases` | above the project | every spelling that means that supplier |
| `items` | above the project | one row per material — `canonical_name`, `category`, `default_unit`, `pack_size`, `pack_unit` |
| `item_aliases` | above the project | every spelling that means that item |
| `purchases` | per project | one row per **document** — supplier, date, invoice no, totals |
| `purchase_lines` | per project | the items on that document, N per purchase |
| `payments` | per project | one row per time money changed hands |
| `receipts` | per project | attachments, now hung off the document |

All eight follow the existing rules exactly: `user_id` with `on delete cascade`,
RLS enabled, one `auth.uid() = user_id` policy, CHECK constraints that reject
rather than coerce.

**Four things about `purchases` worth knowing before you touch it:**

- **`gross_total` is a Postgres GENERATED column** — `net_total + vat_total`,
  stored, not writable. Read it; never try to set it. This is how §2 rule 1 is
  honoured for a column the document itself carries.
- **Balance and payment status are not columns.** `balance = gross_total − Σ
  payments.amount`, and Paid / Partial / Pending derives from that. Computed by
  `computePurchase` in `lib/purchases.ts` on every read, with the same `0.001`
  tolerance `buildTrades` uses.
- **`origin` and `entry_source` answer different questions.** `origin` is where
  the data came from (`manual` / `excel` / `text` / `invoice_ocr` /
  `legacy_import`); `entry_source` is which half of the app it belongs to
  (`diary` / `ledger`). Do not merge them — see §5.
- **`entry_status`** is the lifecycle flag copied from `expense_entries.status`
  (`Planned` / `In Progress` / `Paid` / `Cancelled`). It is **not** a payment
  state. It exists because every summary in the app excludes cancelled rows, and
  that had to survive the copy.

**`public.norm_key(text)`** — an IMMUTABLE SQL function added by `0008`: trim,
lower-case, collapse internal whitespace. Every uniqueness index on the new
tables uses it, and it is deliberately the same rule as `priceKey()` in
`lib/summary.ts` and `normaliseName()` in `lib/purchases.ts`. All three must
stay in step or the database, the Price Tracker and the alias matcher will
disagree about what one item is.

**What the backfill did** (`0008` §8): every `expense_entries` row became one
`purchase` + exactly one `purchase_line`, plus a `payments` row where
`paid_amount > 0` and a `receipts` row where `receipt_url` was set.
`purchases.legacy_entry_id` points back at the row it came from — that is both
the audit trail and what makes the migration re-runnable.

Money mapping, which is the part that has been got wrong before (§3.1):

| New column | From | Note |
|---|---|---|
| `purchases.net_total`, `purchase_lines.line_net` | `actual_amount` | ex-VAT |
| `purchases.vat_total` | `round(actual_amount × vat_rate / 100, 2)` | |
| `purchases.gross_total` | generated | `= computeEntry`'s `total_incl_vat` |
| `purchases.quoted_gross` | `quoted_amount` | incl-VAT for this import — kept **outside** net/vat/gross |
| `payments.amount` | `paid_amount` | incl-VAT, copied unchanged |
| `purchase_lines.qty` / `unit_price` | `qty` / `unit_cost` | |
| `purchase_lines.unit` | — | null: the source records no unit |
| `purchases.purchase_date` | `paid_date` | see below |

> ⚠️ **`purchase_date` is really the paid date.** The spreadsheet has no
> purchase-date column at all — the only date it ever carried was a hand-typed
> `Paid Date`, so that is what the backfill put there, and it is **null on the
> 91 rows that were never paid**. This mirrors what the Price Tracker already
> does (§6.8) rather than inventing a date, but it means a Phase 1 timeline
> ordered by `purchase_date` is ordering by *payment*, not purchase, for all
> legacy data. Real purchase dates only arrive with the Phase 3 importer.

**Seeding was literal, on purpose.** Suppliers came from distinct
`expense_entries.supplier` — which since 2026-08-17 finally holds real merchant
names, because the import now reads them from the column they were actually
typed into (§3.2). Items came from distinct normalised `description`, and
each got its own original text as its first alias. Nothing is fuzzy-merged:
near-duplicate spellings become two suppliers, and merging them is Phase 3's
alias work, where a human confirms each one. `trade` was **not** used to seed
suppliers: it holds trade categories (`General Builder`, `Plumber`), not
merchant names. It is copied onto `purchases.trade` as free text, exactly as
before.

**Seeding is additive only.** Every insert is `on conflict … do nothing`, and
nothing in `0008` ever *deletes* a supplier or an item. Because both tables sit
above the project, deleting the project does not prune them either — so a
re-import that drops rows leaves orphan merchants behind unless it clears these
tables itself. `0009` does exactly that; see §12.

**`0008` refuses to commit** unless the copy reconciles: per-row incl-VAT totals
within half a penny, per-`entry_source` gross and paid totals within the
accumulated rounding, the three row counts equal, and `expenses_view` reproducing
`expense_entries` field by field. Any failure rolls the whole thing back.

---

## 5. `source` splits the app in two — the single biggest trap

`expense_entries.source` decides which half of the app a row belongs to.

| | `diary` | `ledger` |
|---|---|---|
| Comes from | the spreadsheet, plus anything added in-app | nothing — the import that fed it was retired by `0009` |
| Rows | 111 (weeks 1–23) | **0** |
| Appears in | **Expenses tab** and **all Overview analytics**, **Dashboard cards** | **Trades & Labour**, **Materials & Suppliers**, **Price Tracker** |
| Money | £151,644.78 actual incl-VAT | £0.00 |

> ⚠️ **Since 2026-08-14 the ledger side is empty**, because
> `Renovation_Cost_Tracker-1.xlsx` turned out to be a different job (§3.0).
> The `source` column, its CHECK constraint and every filter listed below are
> **deliberately still in place** — they are correct, cheap, and the only thing
> standing between the app and a double-count the day a second dataset arrives.
> Do not delete them as dead code.
>
> **Consequence for reading the app today:** Trades & Labour and Materials &
> Suppliers now show diary rows only, so their figures finally agree with the
> Overview instead of describing a separate dataset. The Price Tracker is empty
> until unit costs are entered — see §6.8.

**Historical note.** Ledger rows carried `week_number = 1` because that workbook
had no week column. Migration `0003` originally backfilled "weeks 16+" as
ledger, `0005` re-imported them all at week 1, and `0009` removed them —
**never use `week_number` to tell diary from ledger, use `source`.**

**Where the filter lives** — every screen that reports *project spend* must
apply it, and must keep applying it:

- `components/project/ProjectDetail.tsx:73` — `diaryEntries`, feeds Overview
- `components/project/ExpensesTab.tsx:66` — feeds the Expenses list
- `app/(app)/dashboard/page.tsx` — feeds the dashboard cards
  *(added 2026-07-22; its absence was a real bug — the card read 144%)*

Trades / Materials / Prices deliberately use the **full** entry set.

**The new tables carry the same split.** `purchases.entry_source` is copied
straight from `expense_entries.source` by the `0008` backfill and has the same
`diary` / `ledger` CHECK. Everything above applies to it unchanged: a query that
sums both is double-counting. Keep it distinct from `purchases.origin`, which
records where the data came from and has nothing to do with this. See §4.6.

The supplier and item screens are where that is enforced in the UI: every total
on them is split by `entry_source` and never combined, down to the sort order.
See §8.1 and `totalsBySource` in `lib/purchases.ts`.

> ⚠️ **Known inconsistency, currently dormant.** The API summary routes
> (`app/api/projects/[id]/summary/`, `…/summary/by-week`, `…/summary/by-category`,
> `…/export/excel`, `…/export/pdf`) pass **unfiltered** `bundle.entries` into
> `buildSummary`. They therefore return the double-counted figure, unlike the UI.
> Nothing in the app currently consumes them, but the **Excel and PDF exports do**
> — so exports did not match the screen. **With the ledger now empty this makes
> no difference to any number**, so the exports happen to be correct today. The
> bug is still there and still unfixed; it bites again the moment a `ledger` row
> exists.

---

## 6. Every number, and exactly how it is calculated

### 6.1 Per-row derived fields — `lib/calculations.ts`

`computeEntry()` (line 20) turns an `ExpenseEntry` into an
`ExpenseEntryComputed` on **every read**. Nothing here is stored.

| Field | Formula | Line |
|---|---|---|
| `subtotal` | `actual_amount` | 16 |
| `vat_amount` | `actual_amount × (vat_rate / 100)` | 15 |
| `total_incl_vat` | `actual_amount + vat_amount` | 16 |
| `materials_cost` | `qty × unit_cost`, but **only if both > 0**, else `0` | 8–11 |
| `remaining` | `total_incl_vat − paid_amount` | 34 |

`remaining` was `actual_amount − paid_amount` until 2026-08-06. It was changed
because `paid_amount` records the incl-VAT sum actually handed over, so an
ex-VAT basis made every fully-paid VAT-bearing row look overpaid. It now agrees
with `buildTrades` and `buildMaterials`, which already subtracted paid from an
incl-VAT figure.

Note `materials_cost` is informational only — it is **not** used in any total.
Totals always come from `actual_amount`.

`formatCurrency` (line 39) — `en-GB`, GBP, always 2 decimals.

### 6.2 Overview tab cards — `buildSummary`, `lib/summary.ts:21`

Input: **diary entries only**, further filtered by
`ACTIVE = status !== "Cancelled"` (line 19). Every card below excludes
cancelled rows.

| Card label | Field | Formula | Line |
|---|---|---|---|
| **Target Budget** | `target_budget` | `projects.target_budget` — a stored column, not computed | 29 |
| **Total Quoted** | `total_quoted` | `Σ quoted_amount` — **incl-VAT**, see §3.1 | 26 |
| **Actual Total** | `forecast_total` | `Σ total_incl_vat` — i.e. **incl-VAT** | 27 |
| **Variance vs Quote** | `variance` | `forecast_total − total_quoted`, rounded to the penny and normalised so an exact match is `0`, not `-0` | 32 |
| **Paid to Date** | `paid_to_date` | `Σ paid_amount` — **incl-VAT**, see §3.1 | 28 |
| **Remaining to Pay** | `remaining_to_pay` | `forecast_total − paid_to_date` | 44 |
| **Weeks Tracked** | `weeks_tracked` | count of **distinct** `week_number` | 35 |
| *(not shown)* | `contingency_amount` | `max(variance, 0)` | 33 |
| *(not shown)* | `forecast_plus_contingency` | `forecast_total + contingency_amount` | 42 |

Rendered by `components/project/OverviewTab.tsx:57–85`.

**Header "% of budget"** — `ProjectDetail.tsx:89` —
`round(forecast_total / target_budget × 100)`.

> ✅ **The two VAT mismatches that used to live here are gone** (2026-08-06).
> They were artefacts of the import, not of these formulas: `quoted_amount` and
> `paid_amount` now both hold incl-VAT figures (§3.1), so Variance vs Quote and
> Remaining to Pay compare like with like. Every card matches the spreadsheet —
> run `python scripts/verify_against_spreadsheet.py` to re-prove it.
>
> The rounding on `variance` exists because `quoted_amount` is stored to the
> penny while `forecast_total` is derived: across 111 rows the two differ by
> £0.004, which would otherwise render as "-£0.00".

> ✅ **Target Budget is now unset, and that is the fix, not a gap.** It used to
> hold £98,932.12 — the total of `Renovation_Cost_Tracker-1.xlsx`, which is a
> different job (§3.0). The header and the dashboard bar therefore read **153%**,
> a ratio between two unrelated properties. `0009` sets `target_budget = 0`,
> matching the spreadsheet's own blank `Target Budget (incl. VAT)` cell.
>
> **Zero is handled everywhere, deliberately** — the Target Budget card
> (`OverviewTab.tsx:67`), the `% of budget` header (`ProjectDetail.tsx:94`), the
> dashboard bar (`dashboard/page.tsx:59`) and the project list
> (`projects/page.tsx:49`) all check `> 0` and hide rather than divide. Nothing
> renders `Infinity` or `NaN`.
>
> To set a real ceiling, use the **Edit Project** form, or
> `update public.projects set target_budget = … where name = '46 Glenferrie Road';`

### 6.3 Dashboard cards — `app/(app)/dashboard/page.tsx`

| Card | Formula |
|---|---|
| **Spent** | `Σ total_incl_vat` over that project's entries, **excluding `ledger`**, excluding `Cancelled` |
| **Budget** | `projects.target_budget` |
| **% used** | `round(spent / budget × 100)`; bar turns red and text goes red when `spent > budget`; bar width capped at 100% |

Deliberately the same basis as `forecast_total`, so the card and the Overview
header now agree.

### 6.4 Weekly chart + week table — `buildByWeek`, `lib/summary.ts:48`

One row per `week_number`, sorted ascending. Cancelled excluded.

| Field | Formula |
|---|---|
| `materials` | `Σ total_incl_vat` where `category === "Materials"` |
| `labour` | `Σ total_incl_vat` for **every other category** — including `Skip/Disposal` and `Other`. It is "not-materials", not literally labour |
| `vat` | `Σ vat_amount` |
| `total` | `Σ total_incl_vat` |
| `completion_pct` | looked up from `project_weeks`, `0` if no row — **computed but no longer displayed** |

Feeds `components/charts/WeeklySpendChart.tsx` and the read-only Week-by-Week
table in `OverviewTab.tsx` (Week / Labour / Materials / VAT / Total).

> ⚠️ **The Labour/Materials split will not match the sheet's `Summary` tab, and
> that is expected.** Two independent reasons:
> 1. The Summary tab's two columns are **ex-VAT** (it sums `Labour Cost` and
>    `Materials Cost` directly); the app's are **incl-VAT**.
> 2. On **weeks 20–23** every cost was typed into the `Materials Cost` column
>    regardless of the row's `Category`, so the sheet reports £0 labour for
>    those weeks. The app splits on `Category`, which is what the rows say.
>
> The **week totals** — the numbers that feed every card and the chart's bar
> heights — match exactly. `verify_against_spreadsheet.py` checks the split
> against the sheet's *rows* rather than its Summary tab for this reason, and
> prints the Summary columns alongside for comparison.

### 6.5 Category donut — `buildByCategory`, `lib/summary.ts:77`

Two slices only: `Materials` (category = Materials) and `Labour` (everything
else). Both `Σ total_incl_vat`, cancelled excluded.
Feeds `components/charts/CategoryDonut.tsx`.

### 6.6 Trades & Labour tab — `buildTrades`, `lib/summary.ts:91`

Input: **all entries** (diary + ledger). Grouped by `trade`, null → `"Unassigned"`.
Sorted by `actual` descending.

| Field | Formula |
|---|---|
| `quoted` | `Σ quoted_amount` (ex-VAT) |
| `actual` | `Σ total_incl_vat` (incl-VAT) |
| `paid` | `Σ paid_amount` (ex-VAT) |
| `remaining` | `actual − paid` |
| `status` | `Paid` if `paid > 0 && remaining <= 0.001`; `Partial` if `paid > 0`; else `Pending` |

The `0.001` is a float-rounding tolerance, not a business rule.

### 6.7 Materials & Suppliers tab

**Two different shapes** — do not confuse them.

**`buildMaterials` (line 116)** — grouped by supplier, used by the API route
and both exports. Only `category === "Materials"`, cancelled excluded. Supplier
null → `"Unknown supplier"`.

| Field | Formula |
|---|---|
| `cost` | `Σ total_incl_vat` |
| `total` | `Σ total_incl_vat` — **identical to `cost`** |
| `paid` | `Σ paid_amount` |
| `remaining` | `cost − paid` |
| `vat` | `Σ vat_amount` |
| `entries` | row count |
| `payment_methods` | distinct non-null methods |

> Note: the `MaterialSummary` type comments `cost` as "Σ actual_amount", but
> the code sums `total_incl_vat`. **The code is what runs.** `cost` and `total`
> being equal is redundancy, not a bug.

**`buildMaterialLedger` (line 150)** — flat, one row per purchase; this is what
the **UI tab** renders. Sorted by `week_number`, then `paid_date`. Supplier
null → `"—"`. Fields map straight across; `total` = `total_incl_vat`,
`remaining` = the row's computed `remaining`.

Because it is derived from `expense_entries`, **adding a Materials row in the
Expenses form automatically appears in this tab.** There is no separate
materials table.

### 6.8 Price Tracker — `buildPriceHistory`, `lib/summary.ts:184`

Answers "did this item cost more this time?"

**Inclusion:** `category === "Materials"` **and** `unit_cost > 0` **and** not
cancelled. Rows failing any of these are invisible here.

> ⚠️ **This tab is empty as of 2026-08-14, and that is correct.** The
> spreadsheet's `Qty (Materials)` and `Unit Cost (£)` columns are blank on all
> 111 rows, so no diary row passes `unit_cost > 0`. Everything the tab used to
> show came from `Renovation_Cost_Tracker-1.xlsx`, whose `Unit Cost` column
> held the size of each **instalment payment**, not a price per unit — which is
> why Wunda UFH appeared to rise 761.9% between a deposit and its balance. That
> import is gone (§3.0).
>
> The tab fills up honestly from here: enter `qty` and `unit cost` on a
> Materials expense and the second purchase of the same description starts a
> real comparison. `ExpenseForm`'s `lastPriceHint` and `priceWarning` (§10.1)
> read the same data, so they wake up at the same moment.

**Grouping key:** `priceKey()` (line 177) — `description` trimmed, lower-cased,
internal whitespace collapsed. So `"Sand  "` and `"sand"` are the same item.

**Ordering:** by `paid_date`, falling back to `created_at` when null
(`purchaseDate`, line 181). **A missing paid date makes an item sort by import
time**, which can scramble the sequence.

| Field | Formula |
|---|---|
| `delta_pct` | `(unit_cost − previous unit_cost) / previous × 100`; `0` for the first purchase |
| `direction` | `first` \| `same` (\|Δ\| < 0.001) \| `up` \| `down` |
| `first_price` / `latest_price` | first / last `unit_cost` in the sorted list |
| `latest_delta_pct` | the last purchase's `delta_pct` |
| `trend` | the last purchase's `direction` |
| `item` | the **most recent** row's description, original casing |

Sorted with the biggest recent increase first.

### 6.9 Expenses tab totals — `components/project/ExpensesTab.tsx`

Diary rows only (line 66). Filters — week from/to, category, trade, status,
payment method — are applied client-side (line 76), then the footer totals are
summed over the **filtered** set (line 90). So the totals reflect what you are
looking at, not the whole project.

---

## 7. Views

**There is exactly one SQL view and no materialized views.** `0008` added
`public.expenses_view` — see the end of this section. Nothing reads it yet.

Everything else view-like is a **TypeScript function in `lib/summary.ts`**, computed
per request from `expense_entries`. Treat these seven as the app's "views":

| Function | Line | Produces | Consumed by |
|---|---|---|---|
| `buildSummary` | 21 | `ProjectSummary` — the 7 Overview cards | Overview tab, `/summary`, both exports |
| `buildByWeek` | 48 | `WeekTotal[]` | weekly chart, Week-by-Week table, `/summary/by-week` |
| `buildByCategory` | 77 | `CategoryTotal[]` | category donut, `/summary/by-category` |
| `buildTrades` | 91 | `TradeSummary[]` | Trades tab, `/trades`, both exports |
| `buildMaterials` | 116 | `MaterialSummary[]` (by supplier) | `/materials`, both exports |
| `buildMaterialLedger` | 150 | `MaterialLedgerRow[]` (flat) | Materials tab UI |
| `buildPriceHistory` | 184 | `PriceHistoryItem[]` | Price Tracker tab, `/prices`, Excel export |
| `buildPriceAlerts` | 247 | `PriceHistoryItem[]` — only those whose latest unit price rose | the amber alert at the top of the Overview tab |

**Consequence:** changing a formula here changes every screen at once, with no
migration and no backfill. That is the intended design.

`lib/purchases.ts` is the same idea for the new tables — every figure on the
supplier and item screens is derived here on read, and none of it is stored.

| Function | Added | Produces |
|---|---|---|
| `computePurchase` / `computePurchases` | Phase 0 | `paid` (Σ payments), `balance` (`gross_total − paid`), `status` |
| `paymentTotal` | Phase 0 | Σ `payments.amount` — incl-VAT, so measured against `gross_total`, never `net_total` |
| `purchaseStatus` | Phase 0 | `Paid` if `paid > 0 && gross − paid <= 0.001`; `Partial` if `paid > 0`; else `Pending` |
| `normaliseName` | Phase 0 | the matching key — same rule as `priceKey()` and `norm_key()` |
| `ACTIVE_PURCHASE` | Phase 1 | `entry_status !== 'Cancelled'` — the `ACTIVE` of §6.2, for purchases |
| `purchaseOrderKey` | Phase 1 | timeline sort key: `purchase_date` falling back to `created_at` |
| `normaliseUnit` / `unitsComparable` | Phase 1 | whether two unit prices are per the same unit |
| `comparePrice` | Phase 1 | `{ delta_pct, move }` vs the previous purchase — see §8.1 |
| `totalsBySource` | Phase 1 | gross / paid / balance **per `entry_source`**, never combined |
| `lastPurchaseDate` | Phase 1 | the newest non-null `purchase_date` in a set |
| `buildItemTimeline` | Phase 1 | one item's `ItemPricePoint[]`, oldest → newest |

`SETTLED_TOLERANCE` (`0.001`) is shared by `purchaseStatus` and `comparePrice`,
and is the same value `buildTrades` uses — a float-rounding tolerance, not a
business rule.

### 7.1 `public.expenses_view` — the bridge back to the old shape

Added by `0008`. Shaped like `expense_entries` (same column names and types) but
sourced from `purchases` + `purchase_lines` + `payments` + `suppliers` +
`receipts`. It exists so a later phase can point the existing screens at the new
tables without rewriting them, and switch back if it goes wrong. **Nothing reads
it today.**

- **Created `with (security_invoker = true)`, and that is not optional.** A
  plain Postgres view runs with its *owner's* rights and would hand every user
  everyone else's rows, because RLS on the base tables is the only thing scoping
  data in this app (§9). Requires Postgres 15+.
- Two honest differences from the table: `id` is the **purchase** id, not the old
  entry id (`legacy_entry_id` is exposed alongside it so the mapping stays
  visible); and a purchase with **more than one line** collapses to a single row
  whose description is the first line's, with `qty` and `unit_cost` reported as
  `0` because there is no single answer. Every backfilled purchase has exactly
  one line, so the view is exact for all current data — that changes the moment
  Phase 2 or 3 creates a real multi-line invoice.
- `0008` will not commit unless the view reproduces `expense_entries` field by
  field across every row.

---

## 8. Screens and routes

### Pages — `app/(app)/`

| Route | File | Shows |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | project cards: Spent, Budget, % bar |
| `/projects` | `projects/page.tsx` | project list |
| `/projects/new` | `projects/new/page.tsx` | create project |
| `/projects/[id]` | `projects/[id]/page.tsx` → `ProjectDetail.tsx` | the 5 tabs |
| `/projects/[id]/edit` | `…/edit/page.tsx` | edit project |
| `/projects/[id]/expenses/new` | `…/expenses/new/page.tsx` | add expense |
| `/suppliers` | `suppliers/page.tsx` | supplier list — see §8.1 |
| `/suppliers/[id]` | `suppliers/[id]/page.tsx` | one supplier's statement |
| `/items` | `items/page.tsx` | item list |
| `/items/[id]` | `items/[id]/page.tsx` | one item's price timeline |
| `/settings` | `settings/page.tsx` | trade lookups |
| `/` | `app/page.tsx` | login |
| `/reset-password` | `reset-password/page.tsx` | password reset |

### Navigation — `components/ui/AppNav.tsx`

Two components, rendered together by `app/(app)/layout.tsx`; each is hidden at
the other's breakpoint (`sm` = 640px).

- **`TopNav`** (`hidden sm:block`) — the desktop horizontal bar.
- **`MobileNav`** (`sm:hidden`) — a compact sticky top bar with a hamburger that
  opens a **left-hand slide-in drawer**. Replaced the old `BottomNav` tab bar on
  2026-08-05. The drawer closes on route change, on Escape, and on overlay click,
  and locks body scroll while open.

`isActive()` is shared. Note `/projects` matches project detail pages but
deliberately **excludes** `/projects/new`, which is its own nav item — before
2026-08-05 both lit up at once.

### Responsive pattern for tables

Every data table renders twice: a `sm:hidden` card list and a
`hidden sm:block` table, from the same array. This applies to the Expenses,
Trades, Materials and Price Tracker tabs and the Week-by-Week table. **If you
add a column, add it to both**, or it will be invisible on a phone.

### The five tabs — `components/project/`

`ProjectDetail.tsx` is the client shell. It holds entries in state, derives
`diaryEntries`, and computes all seven summaries with `useMemo`.

| Tab | Component | Basis |
|---|---|---|
| Overview | `OverviewTab.tsx` | **diary only** |
| Expenses | `ExpensesTab.tsx` | **diary only** |
| Trades & Labour | `TradesTab.tsx` | all entries |
| Materials & Suppliers | `MaterialsTab.tsx` | all entries |
| Price Tracker | `PricesTab.tsx` | all entries |

### 8.1 The supplier and item screens (Phase 1)

Four routes, added 2026-08-14, reading the §4.6 transaction core. They are
**read-only** — no form, no API route, no mutation of any kind; writes are
Phase 2's job. All four are async Server Components with `dynamic =
"force-dynamic"`, and all four ship **no client JavaScript**: the expand/collapse
on a purchase is a plain `<details>` element, not React state.

They are also **cross-project by design**. A supplier and an item sit above the
project (§4.6), so these pages deliberately span every project at once — which
is why none of them shows a "project total".

| Route | Loader in `lib/data.ts` | Shows |
|---|---|---|
| `/suppliers` | `getSuppliers()` | every supplier: records, diary spend + owed, ledger spend + owed, last purchase. Sorted by record **count** |
| `/suppliers/[id]` | `getSupplierBundle(id)` | four stat cards and one statement table **per `entry_source`**: date, invoice, project, gross, paid, balance, status, payment dates + methods, running total. Each row expands to its lines and payments |
| `/items` | `getItems()` | every **Materials**-category item (Labour items are filtered out): category, unit, times bought, suppliers, latest unit price, trend, last bought. Sorted by times bought |
| `/items/[id]` | `getItemBundle(id)` | the price timeline, oldest → newest across every supplier and project: date, source, supplier, project, invoice, qty, unit, unit price, line net, and the change vs the previous purchase |

The loaders follow `getProjectBundle`'s shape: a fixed handful of queries per
page, never one per row, and never a `.eq("user_id", …)` — RLS scopes it (§9).
`selectIn()` skips a round trip when the id list is empty.

**Three rules these screens are built on. Breaking any one of them makes the
numbers lie:**

1. **Diary and ledger money is never added up.** Every total on every one of
   these pages is split by `entry_source` and labelled — separate columns on the
   list, separate card groups and separate tables on the detail pages, and a
   separate running total per group. This is §5 applied to `purchases`: the two
   overlap, so a combined figure is the double-count. The supplier list is even
   *sorted* on the record count rather than on money for the same reason.
   `components/purchases/SourceNote.tsx` says so on screen.
2. **Cancelled purchases are excluded everywhere**, matching `ACTIVE` in §6.2.
3. **A percentage is never computed across two different units.** See below.

**Unit handling — the point of the whole feature.** `comparePrice` in
`lib/purchases.ts` only returns a percentage when the two purchases are per the
same unit. Otherwise it returns `move: 'unit_change'` with a **null** delta, and
`PriceMoveBadge` renders "bag → tonne — check pack size" instead of a number.
Two rows that both record *no* unit compare as equal — that is the entire legacy
dataset, where `purchase_lines.unit` is null everywhere, and it is the basis the
Price Tracker already compares on. A recorded unit never compares equal to a
missing one.

**The delta chain runs within one `entry_source`.** Chaining a ledger price onto
a diary price would compare a purchase against its own duplicate record and
invent a price movement that never happened.

**Lines with no unit price stay in the timeline** but carry no delta and do not
advance the chain. This is not a gap to be filled: the spreadsheet's `Qty` and
`Unit Cost` columns are empty on all 111 rows (§3.1), so every diary line
legitimately has no price per unit, and the item pages say so rather than
showing a zero. **Since `0009` that is now every line in the database**, so the
item timelines show dates and quantities but no prices until unit costs start
being entered. That is the honest state, not a regression — the prices these
pages used to show came from the retired import and were instalment amounts
(§3.0).

> ⚠️ **The timeline is ordered by `purchase_date`, which for legacy data is
> really the *paid* date, and is null on 91 rows** (§4.6). `purchaseOrderKey`
> falls back to `created_at` for those, so an undated row sorts by import time —
> the same caveat §6.8 records for the Price Tracker. Real purchase dates only
> arrive with the Phase 3 importer.

### API — `app/api/`

All handlers call `requireUser()` first.

| Route | Methods | Purpose |
|---|---|---|
| `/api/projects` | GET, POST | list / create |
| `/api/projects/[id]` | GET, PATCH, DELETE | one project |
| `/api/projects/[id]/expenses` | GET, POST | list / add entries |
| `/api/projects/[id]/expenses/[eid]` | PATCH, DELETE | one entry |
| `/api/projects/[id]/summary` | GET | `buildSummary` ⚠️ unfiltered |
| `/api/projects/[id]/summary/by-week` | GET | `buildByWeek` ⚠️ unfiltered |
| `/api/projects/[id]/summary/by-category` | GET | `buildByCategory` ⚠️ unfiltered |
| `/api/projects/[id]/trades` | GET | `buildTrades` |
| `/api/projects/[id]/materials` | GET | `buildMaterials` |
| `/api/projects/[id]/prices` | GET | `buildPriceHistory` |
| `/api/projects/[id]/weeks` | POST/PUT | save `completion_pct` — **no longer called by any screen** |
| `/api/projects/[id]/export/excel` | GET | xlsx ⚠️ unfiltered |
| `/api/projects/[id]/export/pdf` | GET | pdf ⚠️ unfiltered |
| `/api/expenses/[eid]/receipt` | POST | upload to `receipts` bucket |
| `/api/invoices/upload-url` | POST | signed upload URL + new `invoice_uploads` row (migration 0010) |
| `/api/invoices/[id]` | GET | the upload row + a 5-min signed read URL for the file |
| `/api/invoices/[id]/extract` | POST | download → extract → resolve; always ends on a terminal status |
| `/api/invoices/[id]/commit` | POST | writes the reviewed invoice via `createPurchase`; no UI reaches this yet |
| `/api/lookups/trades`, `/[id]` | GET/POST/PATCH/DELETE | trade lookups |
| `/api/auth/signout` | POST | sign out |

---

## 9. Auth and RLS

- `middleware.ts` runs `updateSession` on every non-static path to refresh the
  Supabase session cookie.
- Route Handlers use the **server** client (`lib/supabase/server.ts`), never the
  browser client.
- `createServiceClient()` (service-role key) is for storage MIME validation and
  signed URLs **only**.
- Every table has one policy: `for all using (auth.uid() = user_id) with check
  (auth.uid() = user_id)`.
- **No query anywhere filters by `user_id`.** Scoping is entirely implicit.

**An empty result is ambiguous** — it means either "no rows" or "rows owned by
a different user". This exact ambiguity caused a real incident. See §11.

---

## 10. Validation

Runs **both** client-side and server-side from the same file,
`lib/validation.ts`.

- `validateProject` — name required, ≤ 200 chars; `target_budget ≥ 0`; status
  in the allowed set.
- `validateExpense` — `week_number` a positive integer; description required,
  ≤ 200 chars; category in the allowed set; all five amounts ≥ 0;
  **`vat_rate` exactly 0 or 20**; status and payment method in their sets.
- `lib/expense.ts` → `buildExpensePayload()` normalises a form body into a DB
  payload — coerces the six numeric fields, maps `""` → `null`, defaults
  `status` to `Planned`.

These mirror the DB CHECK constraints. If you change a constraint, change both.

### 10.1 Non-blocking warnings in the expense form

Separate from validation: `components/forms/ExpenseForm.tsx` computes four
advisories that **never block saving**. They exist to catch mistakes at entry
time rather than in a report weeks later. All are pure `useMemo` over
`priorEntries` — no DB round-trip.

| Warning | Fires when | Rendered |
|---|---|---|
| `lastPriceHint` | Materials, description matches a past purchase, no unit cost typed yet | grey box: what it cost last time |
| `priceWarning` | as above, plus a unit cost is entered | red / green / grey box with `± %` vs last purchase |
| `duplicateWarning` | same normalised description **and** same week **and** actual within £0.005 of an existing non-cancelled entry | amber, under Description |
| `overpaidWarning` | `paid_amount − actual_amount > 0.005` | amber, replaces the Amounts hint |
| `unitMismatch` | Materials, `qty > 0` and `unit_cost > 0` and `\|qty × unit_cost − actual\| > 0.01` | amber, with a one-click fix |

`duplicateWarning` uses `priceKey()` from `lib/summary.ts` — the same
normalisation the Price Tracker groups on, so the two always agree on what
counts as "the same item".

**`priorEntries` must be passed in or all of these silently do nothing.** It
defaults to `[]`. Both call sites pass it: `ExpensesTab.tsx` (full entry set)
and `AddExpensePanel.tsx` via `expenses/new/page.tsx` (`bundle.entries`).

### 10.2 Entry shortcuts

- **Description and Supplier are `<datalist>` type-aheads** built from
  `priorEntries`, de-duplicated case-insensitively. Beyond saving typing, this
  keeps spellings consistent — divergent spellings would split one item into two
  in the Price Tracker.
- **Repeat** (`ExpensesTab` row action) opens the form via the `template` prop:
  it copies description, category, trade, supplier, notes, VAT, qty, unit cost
  and amounts, but resets week to `nextWeek` and clears paid amount / paid date /
  payment method / invoice ref / status. So repeating a purchase leaves only the
  price to change — and changing it immediately trips `priceWarning`.
- `template` is **ignored when `expense` is set**; editing always wins.
- Optional fields (date paid, payment method, room, invoice ref, notes, receipt)
  sit behind a collapsed toggle, so a quick on-site entry is short. The toggle
  auto-opens when editing an entry that already uses any of them.

---

## 11. Data recovery

**Every `user_id` is `references auth.users(id) on delete cascade`.** Deleting
an auth user silently destroys all of that user's projects, expenses, weeks and
trade lookups. **This has already happened once.**

If the app shows no data:

1. **Query counts in the SQL editor** (which bypasses RLS). All zeros means the
   rows are gone, not hidden — RLS is a red herring.
2. **Check `select id, email from auth.users`.** A recreated account gets a
   **new UUID**. Same email does *not* mean same user.
3. Beware the decoy: `trg_seed_trades` gives a fresh account 13 trade lookups
   immediately, so "some data exists" is misleading.
4. **Rebuild from the spreadsheet.** Set `USER_ID` at the top of
   `scripts/build_import_sql.py` to the current UUID, run
   `python scripts/build_import_sql.py`, then run the regenerated
   `supabase/migrations/0009_reimport_file1_only.sql` in the SQL editor,
   **followed by `0008_transaction_core.sql`** to rebuild the purchases,
   suppliers and items from it. Do **not** also run `0005`, `0006` or `0007` —
   all three are superseded and carry do-not-run banners.

`0009` is **re-runnable** — it deletes the prior import of the project first,
and it refuses to commit if any week total disagrees with the spreadsheet.

Current UUID: `5d3fc9ff-92a3-4923-a18b-7eb5eade3105` (`admin@pk.com`).

**Open risk, deliberately unchanged:** the `on delete cascade` FKs are still in
place. The same deletion would cause the same loss again.

---

## 12. Migrations

| File | What it does | Applied |
|---|---|---|
| `0001_init.sql` | 4 tables, indexes, `updated_at` triggers, RLS policies, `trg_seed_trades`, `receipts` bucket + policies | ✅ |
| `0002_quoted_actual_paid.sql` | drops the hours × rate model; adds `quoted_amount` / `actual_amount` / `paid_amount`; adds the price-lookup index | ✅ |
| `0003_expense_source.sql` | adds `source` (`diary`/`ledger`) and backfills weeks 16+ as ledger | ✅ |
| `0004_reassign_orphaned_data.sql` | **deleted, never applied** — written against a wrong hypothesis | ❌ |
| `0005_reimport_data.sql` | weeks 1–15 rebuild. **Superseded by 0007 — do not run.** Stored incl-VAT totals in `actual_amount`, causing double VAT | ⚠️ ran 2026-07-22 |
| `0006_mark_paid_entries.sql` | marked the 20 paid diary rows. **Superseded by 0007 — do not run.** Would now overwrite `paid_amount` with the ex-VAT figure | ⚠️ ran 2026-07-22 |
| `0007_reimport_weeks_1_23.sql` | full rebuild from both spreadsheets, weeks 1–23. **Superseded by 0009 — do not run.** It re-imports the other job's 96 ledger rows and restores the £98,932.12 budget | ⚠️ ran 2026-08-14 |
| `0008_transaction_core.sql` | the Route C transaction core: 8 new tables, `norm_key()`, RLS, the backfill of every expense row into one purchase + one line, and `expenses_view`. Additive — changes nothing that already existed. Re-runnable | ✅ ran 2026-08-14 |
| `0009_reimport_file1_only.sql` | rebuild from `..._Updated.xlsx` **alone**: 111 diary rows, 0 ledger rows, `target_budget = 0`, and **33 real merchants in `supplier`** (§3.2). Also clears `suppliers` and `items`, which `0008` seeds but never prunes. **Generated** by `scripts/build_import_sql.py`. Idempotent, and **aborts the transaction unless every week total equals the spreadsheet's** | ⬜ **not yet run** |

`0009` is a **generated file**. Edit the Python script and regenerate — never
hand-edit the SQL.

**Run `0009` first, then `0008` immediately after.** `0008` copies whatever is
in `expense_entries` at the moment it runs, and `0009` deletes the project —
`purchases.project_id` is `on delete cascade`, so the backfill goes with it.
Between the two runs, `/suppliers` and `/items` are empty.

**Why `0009` deletes `suppliers` and `items` itself:** they sit *above* the
project (§4.6), so the project delete does not reach them, and `0008`'s seeding
is `on conflict do nothing` — additive only, it never removes anything. Without
that explicit delete, all 37 merchants seeded from the retired import would
linger on `/suppliers` and `/items` with no purchase behind them. The aliases
cascade, and `purchases.supplier_id` / `purchase_lines.item_id` are
`on delete set null`, so nothing else is disturbed.

### Scripts

| Script | Reads | Writes |
|---|---|---|
| `scripts/build_import_sql.py` | `..._Updated.xlsx` only | `0009_reimport_file1_only.sql` |
| `scripts/verify_against_spreadsheet.py` | the generated `0009` SQL + `..._Updated.xlsx` | nothing — prints a pass/fail report |
| `scripts/gen_mark_paid_sql.py` | — | **disabled**; exits with an explanation |

`verify_against_spreadsheet.py` is the regression test this project never had.
It parses the rows back out of the generated SQL, replays `computeEntry`,
`buildSummary`, `buildByWeek` and `buildByCategory` in Python, and diffs the
result against the spreadsheet — per row, per week, and per card. Exit code 0
means the app and the spreadsheet agree. Run it after any change to the import.

---

## 13. Current figures

Project `46 Glenferrie Road`. **The right-hand column is what the app shows once
`0009` is run** (it has not been run yet — see §12). `0008` is additive and
moves none of it.

| | After `0007` (2026-08-14) | After `0009` |
|---|---|---|
| Target Budget | £98,932.12 | **£0.00 — card hidden** |
| Total Quoted | £151,644.78 | £151,644.78 *(unchanged)* |
| Actual Total (incl VAT) | £151,644.78 | £151,644.78 *(unchanged)* |
| Variance vs Quote | £0.00 | £0.00 *(unchanged)* |
| Paid to Date | £13,273.40 | £13,273.40 *(unchanged)* |
| Remaining to Pay | £138,371.38 | £138,371.38 *(unchanged)* |
| Weeks Tracked | 23 | 23 *(unchanged)* |
| Budget used | 153% | **hidden** |
| Diary rows | 111 (20 Paid, 91 Planned) | 111 *(unchanged)* |
| Ledger rows | 96 | **0** |
| Price Tracker items | 37 (11 with a fake delta) | **0 — empty state** |
| Suppliers / Items (`0008`) | 37 / 143 | **33 / 52** — see the note below |
| Rows carrying a supplier | 8 | **46** (45 Materials + `Stevenage Skips`) |

**Only two things moved: the budget, and the ledger.** Every diary figure is
untouched, because the retired import never fed any of them — that is the proof
it was a separate dataset all along.

Every figure in the right-hand column equals the corresponding cell in the
spreadsheet's `Summary` tab — `Target Budget (incl. VAT)` (blank),
`Forecast Total (incl. VAT)`, `Paid to date`, and
`Committed / no paid-date logged` respectively.

> ✅ **Fixed 2026-08-17: `/suppliers` showed seven notes and one merchant.**
> The `Supplier` column had only 8 non-empty cells and seven of them were
> sentences typed into the wrong column. The real merchants were in
> `Task / Description` all along. The importer now reads them from there against
> an owner-confirmed list, and moves the seven notes into `notes` — see §3.2 for
> the rule and the guard that keeps it honest.
>
> | Sheet row | Week | Description | Supplier cell contained | Now |
> |---|---|---|---|---|
> | 88 | 7 | Dave | `£300 PAID FROM OWED` | in `notes` |
> | 98 | 8 | dave | `£400 paid from whats owed` | in `notes` |
> | 100 | 8 | Owen Brickwork | `1 day - to DPC` | in `notes` |
> | 111 | 9 | Owen Brickwork | `all brickwork completed` | in `notes` |
> | 112 | 9 | Dave Builder | `steels in` | in `notes` |
> | 113 | 9 | Labourers | `steels help plus disposal` | in `notes` |
> | 114 | 9 | Toby | `Toby cleared out huge earth pile` | in `notes` |
>
> The **spreadsheet is still wrong** — this is corrected on import, not at
> source. Anyone editing the sheet should type merchants into `Supplier` and
> notes into `Dependencies/Notes`; if a *new* merchant is typed into a Materials
> row's description, `check_suppliers()` stops the next import until the name is
> added to `SUPPLIER_NAMES`.

**The biggest merchants** (incl-VAT, from `python scripts/build_import_sql.py`):
Lawsons £20,631.69 (3 rows) · Alspec Windows £13,472.80 (2) · Cabinets Direct
(Kitchen) £5,000.00 · St Albans Bathroom Centre £4,850.00 · Miscl Roofing
Materials £3,145.42 · Eaves Electrical £3,105.00 · Lionvest £3,050.78 ·
CAD Stairs £3,000.00 · Mark Cornice £2,924.25 · Ryan Steels £2,370.00.

> ⚠️ **Still open, and out of scope of the supplier fix: `items` are merchants
> too.** `0008` seeds `items` from distinct `description`, and on Materials rows
> the description *is* the merchant name — so `/items` lists `Lawsons` and
> `Topps Tiles` as though they were materials. The sheet has no item column to
> read instead, so there is nothing honest to import. Real item names arrive
> with the Phase 3 importer, or as line items typed into new expenses.
>
> As of 2026-08-17, `getItems()` filters to `category === "Materials"`, so
> Labour-category items (subcontractor/trade names seeded the same way) no
> longer show on `/items` — but the merchant-as-item problem above is
> unchanged for the Materials rows that remain.

Use these as a regression baseline. If a change moves one of them, that should
be intentional and recorded in `updates.md`. The cheapest way to check is
`python scripts/verify_against_spreadsheet.py`.

---

## 14. Before you change anything — checklist

2. Ask: does this touch a **diary/ledger** boundary? Re-read §5.
3. Ask: am I about to store a **computed total**? Don't — §2.
4. Ask: does this need a **migration**? If so, it must be run by hand in the
   Supabase SQL editor, and you must say so.
5. If the SQL is generated, edit the **Python script**, not the `.sql`.
6. Run `npm run build` (or `npx tsc --noEmit`).
7. Check the §13 figures still hold, or explain why they moved.
8. **Add an entry to `updates.md`.** This is mandatory.
