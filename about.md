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
   is left disabled. Since `0015` the scope is **"everyone signed in"**, not
   "the row's owner": this is one shared workspace, and a new table needs the
   `shared workspace` policy or it will show a friend an empty tab. See §9.
4. **CHECK constraints reject, they don't coerce.** A `vat_rate` of 17.5 fails
   the insert outright (0, 5 and 20 are the allowed rates since `0011` — 5 was
   rejected too before that). Match the allowed value lists in §4 exactly.
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
| `vat_rate` | numeric(5,2) | **exactly `0`, `5` or `20`** — `5` added by `0011` |
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
delete). `createServiceClient()` (service-role key) is used for MIME validation
and signed URLs, and — the one other exception — by the three Gmail ingestion
routes (`/api/gmail/drain`, `/api/gmail/push`, `/api/gmail/watch/renew`), which
run on a cron with no session and therefore no `auth.uid()` for RLS to compare
against. Those routes scope every statement with an explicit
`.eq("user_id", …)` taken from the owning `gmail_accounts` row; see §8.4 for
the full rule and §13. **Never expose the service client to the browser**, and
nothing running under a user session may use it.

Note that `/api/gmail/watch/renew` accepts two kinds of caller: the daily cron
(`CRON_SECRET`, renews every active mailbox) and a signed-in request from the
"Register / refresh watch" button on `/settings`. A signed-in call is pinned to
that user's own accounts, because the service client would otherwise renew
everybody's.

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
| Appears in | **Costs tab** and **all Overview analytics**, **Dashboard cards** | nothing — see the note below |
| Money | £151,644.78 actual incl-VAT | £0.00 |

> ⚠️ **Since 2026-08-14 the ledger side is empty**, because
> `Renovation_Cost_Tracker-1.xlsx` turned out to be a different job (§3.0).
> The `source` column, its CHECK constraint and every filter listed below are
> **deliberately still in place** — they are correct, cheap, and the only thing
> standing between the app and a double-count the day a second dataset arrives.
> Do not delete them as dead code.
>
> **Consequence for reading the app today (updated 2026-08-20):** Trades,
> Labour, Materials, Suppliers and the Price Tracker no longer read
> `expense_entries` at all — they are built from invoices (§6.6–§6.8), so the
> `source` split does not reach them. It still governs the Costs tab, the
> Overview analytics and the Dashboard cards, which is where it always
> mattered.

**Historical note.** Ledger rows carried `week_number = 1` because that workbook
had no week column. Migration `0003` originally backfilled "weeks 16+" as
ledger, `0005` re-imported them all at week 1, and `0009` removed them —
**never use `week_number` to tell diary from ledger, use `source`.**

**Where the filter lives** — every screen that reports *project spend* must
apply it, and must keep applying it:

- `components/project/ProjectDetail.tsx:73` — `diaryEntries`, feeds Overview
- `components/project/ExpensesTab.tsx:283` — feeds the Costs list
- `app/(app)/dashboard/page.tsx` — feeds the dashboard cards
  *(added 2026-07-22; its absence was a real bug — the card read 144%)*

Trades / Labour / Materials / Suppliers / Prices no longer read entries at all
(§6.6–§6.8), so there is nothing for the filter to do on them.

**The new tables carry the same split.** `purchases.entry_source` is copied
straight from `expense_entries.source` by the `0008` backfill and has the same
`diary` / `ledger` CHECK. Everything above applies to it unchanged: a query that
sums both is double-counting. Keep it distinct from `purchases.origin`, which
records where the data came from and has nothing to do with this. See §4.6.

**The data keeps the split; the screens no longer show it (2026-08-21).**
`totalsBySource` in `lib/purchases.ts` still returns one gross / paid / balance
per `entry_source`, and every loader in `lib/data.ts` still groups by it — that
is the mechanism, and it stays. What changed is the presentation: the words
"diary" and "ledger" came off the retired Excel import, and with the ledger
empty since `0009` every screen was showing the reader a two-sided split with
one side missing, plus a note explaining why the halves must never be added.
`components/purchases/totals.ts` (`combineTotals`) now adds the split up at the
last moment, for display only, on `/suppliers`, `/suppliers/[id]`,
`/projects/[id]/purchases` and the Overview tab's invoice sentence (it fed the
project's invoice banner until that was deleted, §6.2.1); `/items/[id]` does
the same inline for its quantity/net figures. The day a second dataset arrives,
the split is still in the data and the screens are one change away from showing
it again. See §8.1.

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

**The labels changed on 2026-08-28** (the money vocabulary, §6.2.1). The
formulas did not — only the words. Old labels are kept in the table so an old
screenshot or spreadsheet note can still be matched up.

| Card label | Was called | Field | Formula | Line |
|---|---|---|---|---|
| **Budget** | Target Budget | `target_budget` | `projects.target_budget` — a stored column, not computed | 29 |
| **Committed** | Total Quoted | `total_quoted` | `Σ quoted_amount` — **incl-VAT**, see §3.1 | 26 |
| **Cost** | Actual Total | `forecast_total` | `Σ total_incl_vat` — i.e. **incl-VAT** | 27 |
| **Variance** | Variance vs Quote | `variance` | `forecast_total − total_quoted`, rounded to the penny and normalised so an exact match is `0`, not `-0` | 32 |
| **Paid** | Paid to Date | `paid_to_date` | `Σ paid_amount` — **incl-VAT**, see §3.1 | 28 |
| **Owed** | Remaining to Pay | `remaining_to_pay` | `forecast_total − paid_to_date` | 44 |
| **Weeks tracked** | Weeks Tracked | `weeks_tracked` | count of **distinct** `week_number` | 35 |
| *(not shown)* | — | `contingency_amount` | `max(variance, 0)` | 33 |
| *(not shown)* | — | `forecast_plus_contingency` | `forecast_total + contingency_amount` | 42 |

Rendered by `components/project/OverviewTab.tsx`. Each card now carries its
one-line definition as a `hint`, taken from `lib/vocabulary.ts`.

Below the cards sits one sentence saying how much of **Cost** arrived on
invoices, and how much of that is still **Owed**. That sentence replaced the
`InvoiceBanner` — see §6.2.1.

### 6.2.1 The money vocabulary — `lib/vocabulary.ts`

Four words, one quantity each, on every screen:

| Word | The quantity | Columns behind it |
|---|---|---|
| **Committed** | agreed or quoted, incl VAT | `quoted_amount` |
| **Cost** | what it actually cost, incl VAT | `total_incl_vat`, `gross_total`, `line_gross` |
| **Paid** | money handed over | `paid_amount`, `payments.amount` |
| **Owed** | Cost − Paid | `remaining`, `balance` |

**Budget** is deliberately not one of them: it is a target set on the project,
not a figure derived from spend.

Before this, the same number had a different name on nearly every screen —
`total_incl_vat` was *Actual*, *Actual Total*, *Gross*, *Total*, *Invoiced*,
*Total spend* and *Spent*; `total − paid` was *Remaining*, *Balance*,
*Outstanding* and *Owed*. Nothing said those were the same quantity, so each
screen read as a fresh set of figures that had to be reconciled by hand.

The labels are display-only. Column and field names are unchanged, and so is
every formula — `lib/vocabulary.ts` says explicitly that it is what the reader
is told, not what the database calls it.

**The `InvoiceBanner` is gone** (deleted, `components/project/InvoiceBanner.tsx`).
It sat above all seven tabs showing *Invoiced / Paid / Outstanding* off
`purchases`. Because invoice rows arrive with `source: "invoice"` and the diary
filter is `source !== "ledger"`, they were **already counted in the Overview's
Cost card** directly beneath it — so the banner was printing a subset of the
number next to it, in different words, as though it were a separate total.
Anyone comparing the two concluded the app disagreed with itself. It is now one
sentence on Overview that says plainly it is a part of Cost.

The dashboard card had the same fault in miniature — an "Invoices" block headed
*Invoiced* beside *Spent* — and now reads "Of that, on N invoices".

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

### 6.6 Analysis: by trade, and the Labour filter — `lib/invoiceViews.ts`

> Since 2026-08-28 these are **pivots of the Analysis tab**, not tabs of their
> own (§8, "The four tabs"). Every formula below is unchanged — only where the
> reader finds it changed.


> **Changed 2026-08-20.** These read **invoices**, not `expense_entries`. The
> old `buildTrades` in `lib/summary.ts` still exists and still works — the API
> route `/api/projects/[id]/trades` and both exports call it — but no screen
> does. The reason for the move is §3.1: the spreadsheet recorded a total per
> row and nothing else, so nothing below could be computed from it.

Everything on these two tabs starts from `buildInvoiceLines`, which flattens
this project's `purchase_lines` and carries down what the parent `purchases`
row knows (supplier, date, week, trade, category, status). Cancelled purchases
are dropped, and so is any line whose purchase is missing.

Per line: `vat_amount = round2(line_net × vat_rate / 100)`, and
`line_gross = line_net + vat_amount`. VAT is rounded per line and then added —
the same order `purchaseTotalsFromLines` used when the header was written, so a
line total here and the header it came from agree to the penny.

**Trades — `buildTradeRows`.** Grouped by `purchases.trade`, null →
`"Unassigned"`, sorted by `gross` descending.

| Field | Formula |
|---|---|
| `invoice_count` / `line_count` | documents in the group / their lines |
| `quoted` | `Σ quoted_gross`, treating null as 0 |
| `net` / `vat` / `gross` | `Σ net_total` / `Σ vat_total` / `Σ gross_total` |
| `paid` | `Σ payments.amount` for those documents |
| `balance` | `gross − paid` |
| `status` | `purchaseStatus(gross, paid)` — the same rule the invoice screens use |

> **Why this groups whole invoices and not lines.** Payment is recorded against
> a document. Splitting one across that document's lines would invent a figure
> the payment record never stated. Trades and Suppliers therefore roll up
> purchases; Labour and Materials list lines and show no paid column at all.

**Labour — `labourLines`.** One row per line where the invoice's
`category === "Labour"`. Only an explicit Labour counts: guessing that an
uncategorised line is labour would move real money between two screens on no
evidence, and Labour is the figure that gets quoted at people.

> **Added 2026-08-25 — labour can be logged directly.** The tab has a **Log
> labour** button (in the header, and as the empty state's call to action) that
> goes to `/projects/[id]/labour/new`. That form does **not** create a new kind
> of record: it writes one ordinary `purchases` row with a single
> `purchase_lines` row at `category = 'Labour'`, so `labourLines` and every
> other builder in `lib/invoiceViews.ts` picks it up unchanged. Details in
> §6.6.1 below.

#### 6.6.1 Logging labour by hand — `components/forms/LabourForm.tsx`

For work paid direct rather than invoiced: a name, a trade, an hourly rate,
hours, a total, and — only when the status is **Paid** — the payment.

What you type maps onto the transaction core like this. Nothing about the shape
is special; that is the point.

| Field | Stored as |
|---|---|
| Name (worker/subcontractor) | `purchase_lines.description_raw` |
| Trade | `purchases.trade` (free text, no FK, same as everywhere) |
| Rate (£/hr) | `purchase_lines.unit_price`, with `unit = 'hr'` |
| Hours worked | `purchase_lines.qty` |
| Total pay (ex VAT) | `purchase_lines.line_net` |
| VAT rate | `purchase_lines.vat_rate` — 0, 5 or 20 |
| Status | `purchases.entry_status` |
| Notes | `purchases.notes` |

Fixed on save, never asked: `category = 'Labour'`, `invoice_no = null`,
`supplier_id = null`, and (inside `createPurchase`) `origin = 'manual'`,
`entry_source = 'diary'`. `purchase_date` is the payment date when Paid,
otherwise today. `net_total` and `vat_total` are summed from the single line by
`purchaseTotalsFromLines`; `gross_total` is generated by Postgres, as always.

> **A worker is not a supplier.** The name goes on the line, not into
> `suppliers`. Inventing a supplier row for a person would put them on the
> Suppliers screen as a merchant with an account, and would start matching
> future invoices against them by name. Labour entries therefore show as
> "No supplier" on the Suppliers tab, grouped together — which is honest: none
> of them came from a company.

Three rules the form enforces on screen:

- **Total pay is authoritative.** It is prefilled with rate × hours and follows
  those two until you edit it. Once you do, what you typed is what is stored —
  a day that ran over or a cash discount is real and is not arithmetic. When
  the two disagree by more than a penny the form says so at the field and
  offers a one-click "Use £X", exactly like `unitMismatch` in `ExpenseForm`. It
  never silently recomputes, and it never blocks the save.
- **VAT is explicit.** Default 0, labelled *"0% — not VAT registered"* so a
  deliberate nil does not look like an unanswered field. A blank is a
  validation error, not a silent zero — the same rule the invoice review screen
  applies (§2 rule 4).
- **The payment block only exists when Status = Paid.** It is inline in the same
  form and disappears again if the status changes back, and Planned / In
  Progress / Cancelled write **no `payments` row at all** — not even a
  zero-amount placeholder. The amount is auto-filled with the gross (total pay +
  VAT) and follows both live, but is editable; editing it *below* gross shows a
  non-blocking advisory that this records a part payment and that Trades and
  Suppliers will therefore show a balance even though the status reads Paid. It
  saves anyway — a deposit against a labour bill is a real thing.

The payment is written as a **difference**, the same rule the Costs tab's **Pay**
button follows (§4.7): a purchase has no paid column, so the amount handed over is the gap
between what you say is paid and what the `payments` rows already total. On a
new entry that total is zero, so the gap is the whole amount — but it is
computed rather than assumed, so re-saving can never double-pay.

**Consequence, stated rather than filtered:** `buildItemPriceRows` puts every
line with `unit_price > 0` on the Price Tracker, and it has no category filter.
So an hourly rate appears there alongside material prices, as "Dave Gardener,
£25.00 / hr", and its rate is tracked over time like any other unit price.
Deliberately left as-is: a rate that moved is worth seeing, and a filter here
would be the first place the Labour/Materials asymmetry leaked into a third
screen. `resolveItemIds` also creates an `items` row for the name, for the same
reason — the item timeline on `/items` is what makes that tracking work.

**Editing.** There is no separate labour edit route. A labour entry is an
ordinary purchase, so it is edited on `/projects/[id]/purchases/[pid]/edit`
through `PurchaseForm` — which is where the Labour tab's row links already go.

### 6.7 Analysis: by material and by supplier — `lib/invoiceViews.ts`

**Materials — `materialLines`.** One row per invoice line where the category is
**not** `"Labour"` — so Materials, Skip/Disposal, Other **and uncategorised**.

> The asymmetry against Labour above is deliberate. `purchases.category` is
> optional and the invoice extractor does not set it, so uncategorised is the
> common case. Requiring `category === "Materials"` hid every uploaded invoice:
> the tab read "no materials" while the lines sat in the database. Uncategorised
> lines are counted here and the tab says how many, so the split can be
> corrected on the invoice.
>
> `isLabour` in `lib/summary.ts` follows the same rule, which is what keeps the
> Overview donut and this tab describing the same money.

Each row shows date, week, item, supplier, qty + unit, unit price, net, VAT and
total, and links to its invoice. `buildMaterials` and `buildMaterialLedger` in
`lib/summary.ts` are unchanged and still feed `/api/projects/[id]/materials`
and both exports.

**Suppliers — `buildSupplierRows`.** The same invoices grouped by
`supplier_id`, with one shared bucket for headers naming no supplier
(`"No supplier"`). Same columns as Trades, plus the distinct categories bought,
and expandable to the lines bought from that merchant.

This is the **project-scoped** view. `/suppliers` in the nav bar is the
cross-project one (§8.1) and is a different question.

### 6.8 Analysis: price history — `buildItemPriceRows`, `lib/invoiceViews.ts`

Answers "did this item cost more this time?" — the reason the spreadsheet was
dropped in favour of invoices at all.

**Inclusion:** any line with `unit_price > 0` on a non-cancelled purchase.
`£0 per unit` is not a price; letting one in would invent a −100% drop followed
by an infinite rise. Category is **not** a condition, so a day rate is tracked
alongside a bag of cement.

**Grouping key:** `items.id` when the line was matched to an item, so two
spellings that resolved to the same item share one timeline. Unmatched lines
fall back to the normalised description — the same rule as `priceKey()` and
`public.norm_key()`.

**Ordering:** by `purchases.purchase_date`, with `invoice_no` breaking ties so
undated lines stay in a stable order between renders.

| Field | Formula |
|---|---|
| `delta_pct` / `move` | `comparePrice(current, previous)` in `lib/purchases.ts` |
| `first_price` / `latest_price` | first / last `unit_price` in the sorted list |
| `latest_delta_pct` / `trend` | the last point's `delta_pct` / `move` |
| `total_qty` / `total_net` | `Σ qty` / `Σ line_net` |
| `units` / `suppliers` | every distinct unit / merchant this item was bought in or from |
| `item` | the **most recent** line's item name — what the last document called it |

Sorted with the biggest recent rise first; a null `latest_delta_pct` (first buy,
or a unit change) sorts last.

> ⚠️ **A percentage is only shown when both prices are per the same unit.**
> `comparePrice` returns `move: "unit_change"` and `delta_pct: null` when the
> unit differs, and `PriceMoveBadge` renders that as `bag → tonne — check pack
> size` rather than a number. `£12 a bag` against `£12 a tonne` is not a 0%
> change, and a price alert that lies once gets ignored for ever.
>
> The old `buildPriceHistory` had neither the unit check nor a null delta — it
> is what reported Wunda UFH rising 761.9% between a deposit and its balance
> (§3.0). It still exists for `/api/projects/[id]/prices` and the Excel export,
> and still carries that weakness.

### 6.9 Costs tab totals — `components/project/ExpensesTab.tsx`

Diary rows only. Search (description / supplier / trade), the **All · Owed ·
Paid** quick filter and the six optional filters — week from/to, category,
trade, status, payment method — are all applied client-side in one pass, then
the footer totals are summed over the **filtered** set. So the totals reflect
what you are looking at, not the whole project.

**Cancelled rows are listed but never counted**, in the grand totals or in a
week subtotal. That is unchanged, and it means the footer cannot be reconciled
by adding up the rows on screen; since 2026-08-28 a Cancelled row's expander
says so in as many words.

**Each week carries its own subtotal** — `Week 12 · Cost £3,410 · Owed £900` —
on the same basis. Weeks are listed newest first.

**Owed has no column.** It is `Cost − Paid`, so it is shown where it answers a
question — the row expander and the totals row — rather than as a fourth money
column repeating a subtraction. **Committed has no column either** unless
*Compare to committed* is ticked, which swaps the Cost column for
`Committed → Cost` with a variance chip per row. Nothing about how any of these
is calculated changed; see §6.1 and §6.2.1.

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
| `buildTrades` | 91 | `TradeSummary[]` | `/trades`, both exports |
| `buildMaterials` | 116 | `MaterialSummary[]` (by supplier) | `/materials`, both exports |
| `buildMaterialLedger` | 150 | `MaterialLedgerRow[]` (flat) | **nothing** — the Materials screen moved to `lib/invoiceViews.ts` |
| `buildPriceHistory` | 184 | `PriceHistoryItem[]` | `/prices`, Excel export |
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
| `/projects/new` | `projects/new/page.tsx` | create project |
| `/projects/[id]` | `projects/[id]/page.tsx` → `ProjectDetail.tsx` | the 4 tabs |
| `/projects/[id]/edit` | `…/edit/page.tsx` | edit project |
| `/projects/[id]/expenses/new` | `…/expenses/new/page.tsx` | add expense |
| `/projects/[id]/purchases` | `…/purchases/page.tsx` → `InvoicesTab.tsx` | invoices filed against this project (read + edit only — adding is at `/invoices`). **The same component as the Invoices tab** since 2026-08-28 |
| `/projects/[id]/purchases/[pid]/edit` | `…/purchases/[pid]/edit/page.tsx` | edit one invoice |
| `/invoices` | `invoices/page.tsx` | add an invoice: upload or manual — see §8.2 |
| `/invoices/upload` | `invoices/upload/page.tsx` | upload queue |
| `/invoices/new` | `invoices/new/page.tsx` | manual entry |
| `/invoices/[uploadId]/review` | `invoices/[uploadId]/review/page.tsx` | review an extracted invoice |
| `/directory` | `directory/page.tsx` → `Directory.tsx` | the cross-project register: Suppliers ⇄ Items, one pivot — see §8.1 |
| `/suppliers` | `suppliers/page.tsx` → `Directory.tsx` | the Directory on its Suppliers half (route kept — many links point at it) |
| `/suppliers/[id]` | `suppliers/[id]/page.tsx` | one supplier's statement |
| `/items` | `items/page.tsx` → `Directory.tsx` | the Directory on its Items half |
| `/items/[id]` | `items/[id]/page.tsx` | one item's price timeline |
| `/settings` | `settings/page.tsx` | trade lookups |
| `/` | `app/page.tsx` | login |
| `/reset-password` | `reset-password/page.tsx` | password reset |

> Brought up to date 2026-08-19, when the invoice routes moved to `/invoices`
> (§8.2). The stale `/projects` row went at the same time — that page no longer
> exists; the dashboard is the only project list (see `AppNav.tsx`).

### 8.2 Invoice upload (Phase 5a) — getting a file into extraction

Four routes, added 2026-08-17 and **moved out from under `/projects/[id]/` on
2026-08-19** — they now live at the top level, under `/invoices`:

| Route | File | Shows |
|---|---|---|
| `/invoices` | `invoices/page.tsx` | chooser: **Upload invoice** or **Enter manually** |
| `/invoices/upload` | `invoices/upload/page.tsx` → `UploadInvoicePanel.tsx` | drag-drop / camera upload queue, one row per file |
| `/invoices/new` | `invoices/new/page.tsx` | manual entry — the same `PurchaseForm` |
| `/invoices/[uploadId]/review` | `invoices/[uploadId]/review/page.tsx` | the review-and-correct screen (Phase 5b) — see below |

**Why they are not under a project any more.** They used to be, and that
forced the project to be the *first* question: you had to open a project
before you could photograph anything. In practice it is the *last* thing you
know — you have a pile of invoices and decide which job each belongs to while
looking at it. So **the project is now a field on `PurchaseForm` itself**,
asked at the moment the invoice is saved, and `Invoices` is a top-level nav
item alongside Suppliers and Items (which are cross-project for the same
reason — §4.6).

What that required:

- `invoice_uploads.project_id` became **nullable** (migration `0012`). An
  upload in flight genuinely has no project; a `committed` one always does,
  and a CHECK enforces exactly that. Nothing else in the codebase ever read
  the column — every other query finds an upload by its own id — so widening
  it moved no figure.
- `POST /api/invoices/upload-url` takes `project_id` optionally, and stores a
  project-less file under `{user.id}/unassigned/…`. The file is never moved
  once a project is chosen: the row records where an invoice belongs, not the
  path.
- `POST /api/invoices/[id]/commit` takes `project_id` from the review screen,
  falling back to the upload's own, 400s if it has neither, verifies the
  caller owns it (RLS read), files the purchase there and writes it back onto
  the upload row.
- `getPurchaseFormBundle` accepts `null`. Almost nothing it loads was ever
  project-scoped — suppliers, items, trades and price history are all
  deliberately cross-project — so the only casualties were `project` itself
  (now nullable) and a single `next_week`, which is why the bundle now also
  carries `next_week_by_project`: a week number means nothing until you know
  whose week it is, so picking a project re-defaults the week, but never over
  a week that was typed by hand.

Each project keeps its `/projects/[id]/purchases` list — that is where you
land after saving — and everything that starts this flow points at `/invoices`.
There is one add flow, not one per project.

**Where you start it from, since 2026-08-28 (UX phase 4).** The project header
carries a single **"+ Add"** control — a dropdown on a computer, a bottom sheet
on a phone — offering **Cost**, **Invoice** and
**Labour** (`components/project/AddMenu.tsx`, wired in `ProjectDetail.tsx`).
On a phone the trigger was a floating **+** pill above the tab bar until
2026-09-01, when it turned out `position: fixed` cannot escape the header's
`backdrop-blur-xl` — the pill was being positioned against the header and sat
on the project's title. It is now a small button in the header action row, next
to `⋯`, opening the same sheet. See "Navigation" below for the rule this
broke.
Invoice is this flow, unchanged: `/invoices` → upload or manual → review →
commit. It is the one multi-step flow in the app that earns its steps, so only
the door into it moved.

That replaced four unrelated add patterns, one of which was a genuine bug: the
labour form at `/projects/[id]/labour/new` was reachable **only** from the
Labour view's empty state, so it vanished as soon as the project had any labour
on it. All three items are now reachable at all times, from every tab.

The per-tab add buttons are gone with it. Two places still carry one of their
own, both deliberately:

- **empty states** — "no costs yet", "no purchases yet", "no labour yet". An
  empty screen is the one place the action belongs in the body of the page.
- **`/projects/[id]/purchases`** as a standalone route, which renders
  `InvoicesTab` with `chrome="page"` and so has no project header above it. Its
  "+ Log invoice" button is its only way in.

**`UploadInvoicePanel.tsx`** (Client Component) drives each file through:
`POST /api/invoices/upload-url` → `PUT` straight to the returned signed URL
(a hand-rolled `XMLHttpRequest`, not the Supabase SDK's own
`uploadToSignedUrl`, because the SDK's version reports no upload progress and
a 12MB phone photo is not instant) → `POST /api/invoices/[id]/extract`. The
file itself never reaches a Next.js route — the same 4.5MB-body-cap reason
`upload-url/route.ts` is built the way it is.

Several files can be queued at once, each with its own row and status, so one
failure never blocks the others. Once extraction starts, a Supabase Realtime
subscription on that `invoice_uploads` row is the primary way the UI learns
the outcome; a poll every few seconds runs alongside it from the start and
only backs off (never stops outright) once Realtime confirms it connected —
so a dropped Realtime connection still resolves, just more slowly. A `failed`
row shows the stored error with **Retry** (re-`POST`s `/extract` on the same
row if the file already made it to storage, or resumes from the top if it
didn't) and **Enter manually instead**, which goes to `/invoices/new`.

**The review screen (Phase 5b).** An `extracted` row links to
`/invoices/[uploadId]/review`, a Server Component. It re-validates
`extraction_raw` with `parseExtraction`, re-resolves the supplier and every
line's item against the *current* `suppliers`/`items` tables (not the
snapshot the extract route saw — a supplier added since then still matches),
builds a `PurchaseFormPrefill`, and renders the signed-URL original next to
`components/forms/PurchaseForm.tsx`, prefilled. **There is exactly one
*invoice* form component in the codebase** — `invoices/new/page.tsx`,
`[pid]/edit/page.tsx` and this review page all render the same `PurchaseForm`,
which gained six new *optional* props (`prefill`, `invoiceUploadId`,
`supplierResolution`, `lineResolutions`, `extractedTotals`, `documentNotes`)
that manual entry and editing never pass, so neither of those paths' behaviour
changed.

> Since 2026-08-25 there is a second, much smaller form that also writes
> `purchases` — `components/forms/LabourForm.tsx` (§6.6.1). It is not a
> variant of `PurchaseForm` and does not import it: it asks about a person's
> hours, not about a document, and writes exactly one line. Both go through the
> same `createPurchase` in `lib/purchaseWrite.ts`, which is the thing that
> actually has to stay single.

The two panes are **2fr / 3fr**, not half and half: the document is the
reference, the form is the work. The preview is capped at 60% of screen height
(45% on a phone) with an "Open full size ↗" link under it — before
2026-08-19 it ran to 70–80vh at half width, which pushed the extracted numbers
into columns too narrow to read.

What the added props drive:

- **Supplier field branches on `resolve.ts`'s confidence band.** `certain` —
  preselected, collapsed to a confirmed line with a "Change" link. `likely` /
  `possible` — a candidate list with match scores plus "None of these — add
  new supplier". `none` — the new-supplier fields
  (`components/purchases/SupplierFields.tsx`, extracted so a future
  standalone supplier-creation screen can reuse it) shown already expanded
  and prefilled from the draft, with a collapsed "Search existing suppliers
  instead" link above it. Every branch also offers that search fallback, so
  a weak or absent match is never a dead end.
- **Same pattern per line**, but lighter: `PurchaseForm`'s own exact-match
  lookup already covers `resolve.ts`'s "certain" tier, so only a `likely` /
  `possible` fuzzy suggestion shows anything extra — "Looks like X (72%
  match) — Use this item / It's new". Confirming sets that line's `item_id`
  (previously always `null`) alongside rewriting the description to the
  canonical spelling.
- **Reconciliation warnings render at the field they're about, live**, not a
  banner: the printed net and VAT totals are compared against the *current*
  line totals on every render (so editing a line updates the warning), and
  the printed gross is compared through the pre-existing "Invoice total as
  printed" check by simply prefilling it — one mechanism, not two.
- **The duplicate-invoice check is the pre-existing one**, `PurchaseForm`'s
  own `duplicateInvoice` memo against `bundle.invoices` (already loaded
  across every project). It fires the moment the form mounts, prefilled, so
  it is effectively "before the screen renders its interactive state" without
  a second implementation — just gained a link to the existing purchase.
- **Save posts to `/api/invoices/[id]/commit`**, with a `supplier` decision
  object (`existing` / `new`) built from which branch the user is in, and
  lands on `/purchases/[id]/edit` — the created purchase — rather than the
  list, unlike manual entry.

**Two things the extraction used to lose on the way to that form, fixed
2026-08-18.** Both were silent — a wrong or empty field on a screen whose whole
job is being trusted at a glance:

- **The quantity, when the invoice printed it stuck to the unit.** Merchant
  invoices print the quantity column as `10.000EA` / `5EA` / `2BAG`, and once a
  PDF's layout is gone that arrives as one token; the extractor returned
  `unit: "EA"` with `qty: null`. The prompt asks for them split, but asking is
  not a guarantee — a prompt-only fix earlier the same day did not hold — so
  `splitQtyFromUnit()` in `lib/invoice/normalise.ts` now does it
  deterministically, and a quantity is *only* taken from the unit when none was
  read. As a last resort, a missing qty is derived from `line_net / unit_price`
  when that comes out **whole** and multiplies back to the printed total to the
  penny; a fractional result means a discount or part-load and is left blank.
- **The VAT rate, when it wasn't 0 or 20.** `normaliseVatRate` dropped anything
  else to null and the prefill defaulted the field to `"0"`, so a 5% invoice —
  ordinary on residential renovation work — saved as zero-rated and its VAT
  vanished from every total. `0011` widened the CHECK to 0/5/20 and the rate the
  document prints is now the rate that is kept. A rate still outside the set
  (17.5%, or a misread) leaves the box **empty**, not zero: `documentNotes()`
  names the rate that could not be stored and `validatePurchase` refuses to save
  until a human picks one.

**Known limitation, not fixed here:** the review page's signed read URL is
valid for 10 minutes; a review left open longer needs a reload. `about.md`
§8.2's earlier 5-minute figure was for the `GET /api/invoices/[id]` route,
which this page does not use — it signs its own URL directly.

### Navigation — `components/ui/AppNav.tsx`

Two components, rendered together by `app/(app)/layout.tsx`; each is hidden at
the other's breakpoint (`sm` = 640px).

- **`TopNav`** (`hidden sm:block`) — the desktop horizontal bar, sticky at
  `top-0`, `z-30`.
- **`BottomNav`** (`sm:hidden`) — a **fixed bottom tab bar**, one tab per
  destination, sitting above the iOS home indicator via `pb-safe`. Reinstated on
  2026-08-28, replacing the hamburger + left-hand slide-in drawer that had itself
  replaced a bottom tab bar on 2026-08-05. The reason for going back: the app is
  used almost entirely on phones, and a drawer puts every destination two taps
  and an animation away, behind a control in the hardest corner of the screen to
  reach one-handed. `MobileNav` is kept as a deprecated alias of `BottomNav` so
  any straggling import still compiles.

**Pages reserve room for the bar themselves.** `app/(app)/layout.tsx` puts
`pb-nav` on `<main>` — a utility in `globals.css` that resolves to the bar's
height plus `env(safe-area-inset-bottom)` plus a little air. Anything else fixed
near the bottom edge (the FAB in `Fab`, the toast stack) offsets itself
by `var(--nav-h)` the same way. **A new fixed-bottom element that does not do
this will sit underneath the navigation.**

**And it only works if no ancestor is blurred.** `position: fixed` is measured
from the viewport *unless* some ancestor has a `transform`, `filter`,
`backdrop-filter`, `contain` or `will-change` — any of those makes that ancestor
the frame of reference instead. `PageHeader` is `backdrop-blur-xl`, so a fixed
element rendered inside the header's action slot is positioned against the
header, not the screen. That is exactly what happened to `AddMenu`'s phone
button (2026-09-01): "0.75rem above the tab bar" put it across the project
title. **Put fixed-bottom chrome in the page body, not in the header.**

`PageHeader` (`components/ui/PageHeader.tsx`) is the sticky bar at the top of
every screen: back arrow, title, subtitle, actions, and an optional full-width
row beneath (search fields, the project tab strip). It sits at `z-20` and
`sm:top-12`, which is what keeps it below and clear of `TopNav` on a desktop
screen where both are sticky.

**Four destinations since 2026-08-28** — Dashboard · Invoices · Directory ·
Settings — where there were six.

- **"Add Project" is gone.** It was an *action* sitting in a list of *places*,
  and the Dashboard already carries a "+ Create project" button. `/projects/new`
  is still a route; it simply has no nav item, so `isActive()` no longer excludes
  it and Dashboard now stays lit while you are on it. (Before 2026-08-05 both lit
  at once, which is why the exclusion existed at all.)
- **Suppliers and Items merged into "Directory".** They were two items holding
  the same kind of thing — the cross-project register that sits above the project
  (§4.6) — and neither mentioned the other or the project screen's per-project
  view of the same data. `isActive("/directory")` therefore also matches
  `/suppliers` and `/items`, which still exist and still render the Directory;
  without that the nav goes blank on every supplier and item page.

### The design system — `app/globals.css`, `tailwind.config.ts`, `components/ui/`

Rebuilt mobile-first on 2026-08-28. Three things decide how anything new should
look, and reaching for a raw Tailwind class instead of one of them is how a
screen starts drifting away from the rest of the app.

1. **The component classes in `globals.css`** — `.btn-*`, `.input`, `.textarea`,
   `.label`, `.hint`, `.card`, `.card-flush`, `.card-sunken`, `.row`, `.eyebrow`,
   `.tnum`. These are what every screen already uses, so they are the single
   point where the visual language is set. `.input` is deliberately **16px on
   mobile** and 14px from `sm:` — anything smaller makes iOS Safari zoom the
   viewport when a field is focused, which reads as a bug.
2. **`gray` is overridden, not extended,** in `tailwind.config.ts`. Every
   existing `text-gray-500` now points at a warm, faintly green neutral instead
   of Tailwind's cool default, so the neutrals stop fighting the green brand. The
   brand scale is built *around* the original `#0f5d4a`, which is still
   `brand-700` and `brand.DEFAULT` — the identity did not change, it just gained
   the tints and shades a real interface needs.
3. **The primitives in `components/ui/`** — `Icon`, `Sheet`, `Select`,
   `DatePicker`, `PageHeader`, `List`, `Fab`, `SegmentedControl`, `Badge`,
   `StatCard`, `States`, `Toast`, `ConfirmDialog`, `Drawer`.

Four of those are worth knowing about before writing a form:

- **`Sheet` is the one overlay primitive.** A bottom sheet on a phone, a centred
  dialog from `sm:` up. Everything modal is built on it, so overlays cannot drift
  apart. It **portals into `document.body`**: the panel animates with a
  `transform`, and a transformed ancestor becomes the containing block for
  `position: fixed` descendants — without the portal, a `Select` opened from
  inside a sheet would be clipped to that sheet's box. It also tracks a
  module-level open count so **Escape only closes the topmost sheet**; sheets
  genuinely nest here (the Costs tab's status dialog contains a `Select` and a
  `DatePicker`).
- **`Select` replaces every native `<select>`,** and **`DatePicker` replaces
  every `<input type="date">`.** There are none of either left in the codebase.
  Both keep the same API shape as the control they replaced — `value` in,
  `onChange(value)` out, ISO `yyyy-mm-dd` for dates — so no form logic changed
  when they were swapped in. `Select` gains a search box past 8 options and a
  second `hint` line per option; `DatePicker` gains Today / Yesterday shortcuts,
  which is most of the dates entered here.
- **`Icon` is the only icon set.** The emoji that used to stand in for icons
  (`▦`, `🧾`, `⚙`, `📎`, `▸`) are gone: they render differently on every
  platform and cannot inherit colour.

`components/charts/theme.ts` holds the chart palette. Its three series colours
were checked with a palette validator, not chosen by eye — they clear the
lightness band, the chroma floor and 3:1 contrast against the card, and keep
ΔE ≥ 9.6 between adjacent pairs under protanopia. **Re-validate if you change
them.** The previous colours were three steps of the brand green — a *sequential*
ramp doing a *categorical* job — and the lightest of them sat at 1.6:1 against
the card, so the VAT band was barely visible.

### Responsive pattern for tables

Every data table renders twice: a `sm:hidden` card list and a
`hidden sm:block` table, from the same array. This applies to every project tab
and the Week-by-Week table. **If you add a column, add it to both**, or it will
be invisible on a phone. On the Analysis tab both renders come out of one
`PivotTable` call, so the rule is enforced by the shell rather than by memory.

### The four tabs — `components/project/`

`ProjectDetail.tsx` is the client shell. It holds entries in state and computes
every summary with `useMemo`, from **two different sources** — which is the
thing to know before changing any of them.

| Tab | Key | Component | Basis |
|---|---|---|---|
| Overview | `overview` | `OverviewTab.tsx` | entries, **non-ledger only** |
| Costs | `expenses` | `ExpensesTab.tsx` | entries, **non-ledger only** |
| Invoices | `invoices` | `InvoicesTab.tsx` | `getProjectPurchases` rows — one per document |
| Analysis | `analysis` | `AnalysisTab.tsx` | invoice lines and purchases, pivoted four ways |

> **Seven tabs became four, 2026-08-28.** Trades, Labour, Materials, Suppliers
> and Price Tracker all read the *same* dataset — `invoiceLines` / `purchases`,
> built in `lib/invoiceViews.ts` — grouped by a different column. Five tab stops
> for one `group by` is a pivot wearing a tab strip, so they are one Analysis
> screen with a segmented control. Meanwhile Invoices was the opposite fault: a
> separate *route* that left the tab context entirely and needed a `?tab=` link
> to get back, so it came in as a tab.
>
> The 2026-08-20 split note that used to sit here is superseded. Its reasoning
> was sound about the *data* — Trades and Suppliers roll up whole invoices
> because payment is a document-level fact, while Labour and Materials list
> individual lines (§6.6–§6.8, all still true) — but a difference in row shape
> is a reason for a different column set, not for a different destination.

**Analysis is one screen, four pivots.** The segmented control reads
`By trade · By supplier · By material · Price history`, and every pivot renders
through one `PivotTable` shell (`components/project/PivotTable.tsx`) with one
totals row; a segment supplies its column set and its mobile card and nothing
else. The five components it replaced are deleted.

- **Labour is a filter, not a segment.** "By material" carries a second control
  — `All lines · Materials · Labour` — backed by the same `materialLines()` and
  `labourLines()` builders as before. Making labour a destination of its own
  implied labour lines came from somewhere other than the invoices, which they
  do not: both an invoice filed under the Labour category and a "Log labour"
  entry are purchases, and both arrive through `labourLines()`.
- **The explanatory paragraph above each of those five tables is gone.** Prose
  above a table is a tell that the table's placement is not self-evident. With a
  pivot control the reader chose the grouping a moment ago, so the segment label
  *is* the explanation. The amber "N lines have no category set" note stays —
  that is a statement about the data, not about the screen.
- **Every builder in `lib/invoiceViews.ts` is untouched.** This was a
  presentation change: no calculation and no schema moved.

**Deep links: `?tab=` and `?view=`.** `?tab=expenses` is unchanged (§8 below
says why that key is load-bearing). The new form is
`?tab=analysis&view=trade|supplier|material|labour|price`. The five retired tab
keys — `trades`, `suppliers`, `materials`, `labour`, `prices` — are kept as
**aliases** in `RETIRED` in `ProjectDetail.tsx`: each resolves to Analysis on
the right pivot, `labour` also selecting the Labour filter. They cost a dozen
lines and they keep working every link saved before the collapse, including a
`returnTo` sitting in a half-finished labour form. In-app callers were moved to
the canonical form (`LabourForm.tsx`, `labour/new/page.tsx`).

**The header's "Invoices" button is gone** — it existed only to leave the tab
strip for a route that had no way back, and that route is now a tab. Overview's
"See the invoices" sentence switches tab instead of navigating.

**Why the project page fetches the invoice rows it may not use.**
`projects/[id]/page.tsx` calls `getProjectPurchases` in a `Promise.all` beside
`getProjectBundle`, and passes `purchaseRows` into `ProjectDetail`. That
re-reads purchases, lines, payments and suppliers the bundle already fetched,
on every project page load, whether or not the Invoices tab is opened. It was
chosen over a client fetch on tab activation deliberately: one row builder means
the tab and the `/purchases` route can never disagree, and `router.refresh()` —
which `reloadEntries` already calls after every change — brings the tab up to
date with no extra wiring. If that cost ever matters, the alternative is a
`GET /api/projects/[id]/purchases` and a loading state.

> **`InvoiceBanner` removed 2026-08-28.** Something used to render above this
> tab strip on every tab — a blue "Invoice Summary" card. It is gone, and its
> content is one sentence on Overview. §6.2.1 says why. Every tab labels money
> with the four words in `lib/vocabulary.ts`.

> **The Expenses tab is called "Costs" from 2026-08-28.** Only the word on the
> strip changed — the tab **key is still `expenses`**, because `?tab=expenses`
> is what the invoice edit form's `returnTo` link carries and what every deep
> link into this screen uses. The component file keeps its name too. The tab
> lists invoices as well as expenses, and nobody calls an invoice an expense.

The Costs tab shows **both**: hand-entered `expense_entries` and the
project's invoices, the latter as synthetic entries with an `inv:<uuid>` id
(`purchasesToSyntheticEntries`, `lib/purchases.ts`). Invoice rows carry an
"Invoice" badge, and their **Edit** opens the invoice form rather than the
expense drawer — an invoice's supplier, lines and VAT belong to the document,
and only that form can change them without leaving the header disagreeing with
the lines it is made of.

**One payment state, derived, shared by the button and the dropdown
(2026-08-21).** `paidState` in `lib/calculations.ts` is the single answer to
"how much of this has actually been handed over": `None` for a Cancelled row,
`Paid` when `paid_amount` reaches `total_incl_vat` within half a penny,
`Partial` when something is paid, `Unpaid` otherwise. Nothing about it is
stored. Everything on the Expenses tab reads it:

- **The chip on every row is the derived state, spelled out**: `Unpaid`,
  `Part-paid £400 of £1,200`, `Paid`, or `Cancelled`. "Partial" on its own never
  said how much was left.
- **The stored `status` column is demoted to a small grey flag** beside the
  chip — `Planned` or `In Progress`, and `Marked Paid` when the column claims
  Paid but no money reached the row, which is a disagreement worth seeing.
- **A row whose state is `Unpaid` shows no paid date at all** — `—` in the
  expander, and no date on the mobile card — however old the column value is.
  A Planned row displaying a paid date was the visible half of this bug.
- The **Pay** button appears only when the state is `Unpaid` or `Partial`, and
  reads "Pay balance" on a partial row. A settled row no longer offers to settle
  itself again. It is the row's one primary affordance; everything else
  (Repeat, Edit, View receipt, Delete) is in the row's `⋯` menu, with Delete
  below a divider and in red.

**One control, one dialog (2026-08-28).** Until then the status was a `<select>`
on every row whose `onChange` did one of three different things: choosing `Paid`
opened a payment dialog, choosing `Planned` / `In Progress` on a paid row opened
a *different* dialog, and anything else wrote silently. A control that looks
like a dropdown but sometimes opens a modal is unpredictable, and it was the
worst interaction on the screen.

The chip is now a button, and it always opens the same **Update status** dialog,
which carries status, amount, paid date and payment method together. The **Pay**
button opens that same dialog with `Paid` already chosen and the outstanding
amount filled in. Every guard the dropdown used to hide is still there, now in
`submitStatus` and in sight of the fields it applies to:

- Choosing `Paid` on a row that still owes money and typing no amount is
  **refused in the dialog** — nothing is ever marked Paid with no money against
  it.
- Choosing `Planned` or `In Progress` on a row that has payment data still asks
  the clear-payment question first, and clears `paid_date` / `paid_amount` if
  confirmed. On an *invoice* it only changes the status and says so: an
  invoice's payments are separate rows and are removed on the invoice form (see
  below).
- The paid date still defaults to **today**, because that is when the money
  moved — an invoice's own `paid_date` is the *document's* date.
- Nothing is written until Save, and a failed Save leaves the dialog open with
  the message, because the commonest failure is over-paying an invoice.
- An amount can also be typed against `In Progress`, which is how a part payment
  is recorded without claiming the row is settled. If it happens to settle the
  row, the status lands on `Paid` — the same rule the old dialog applied.

The amount is always sent as the **cumulative** figure. An expense row stores it
directly; for an invoice the PATCH handler turns it into a `payments` row for
the *difference* between what you say is paid and what the payment rows already
total, so submitting twice cannot pay it twice. Paying an invoice *less* than it
already has against it is refused with a 409 — that is a refund or a correction
to a specific payment, and it belongs on the invoice form where you can see
which payment you are changing.

**Six columns, not twelve (2026-08-28).** The desktop table used to carry Wk,
Description, Category, Trade, Notes, Quoted, Actual, Paid, Remaining, Date Paid,
Status and Actions. It now carries:

`Description · Category · Cost · Paid · Status · ⋯`

- **Description** carries a second line — `supplier · trade · week N`, plus a
  📎 when the row has a receipt — which is where Trade and Wk went.
- **Notes**, **date paid** and **payment method** are in a row expander, opened
  by clicking the description. Committed and Owed are in there too.
- **Owed** is `Cost − Paid`, so it is derivable and has no column: it appears in
  the expander, in each week's subtotal header and in the totals row.
- **Committed** appears only when *Compare to committed* is ticked, which swaps
  the Cost column for `Committed → Cost` with a per-row variance chip (over
  quote red, under quote green, "on quote" grey).
- **Rows are grouped by week**, newest first, under a sticky subtotal header
  reading `Week 12 · Cost £3,410 · Owed £900`. `week_number` is the organising
  fact of this data — it is a week-by-week plan — and it used to be a
  two-character first column.

**An invoice row looks different before you click it.** It leads with a violet
document tile and keeps its "Invoice" badge; an expense row leads with a grey
dot. This matters because the two behave differently — an invoice's Edit leaves
the screen for the invoice form, it has no Repeat, and deleting it takes its
lines and payments with it. The test is unchanged: `isInvoice()` keys on the
`inv:` id prefix.

**Filters: a search box and the daily question.** Six always-visible dropdowns
used to fill a card before any data appeared. There is now a **search** input
(description / supplier / trade, same behaviour as the Materials tab), a
segmented **All · Owed · Paid** quick filter — which is the question actually
asked every day — and **+ Add filter**, which adds any of the original six as a
removable pill. A result count (`14 of 111`) and **Clear all** sit beside them.
Every filter predicate is the same one as before.

**Two missing states, both fixed.** The empty check was `entries.length === 0`
while the table rendered `diaryEntries`, so a project holding only `ledger` rows
showed a table with no rows in it and no empty state — invisible today only
because the ledger is empty (§5). It is now `diaryEntries.length === 0`. And a
filter that matches nothing renders "Nothing matches" *instead of* the table and
its footer, the way `MaterialsTab.tsx` already did: a totals row of £0.00 under
an empty table reads as a project that has spent nothing.

**Mobile no longer repeats the table.** The card shows the description, the
cost and the status chip; tapping it expands the same details as the desktop
expander; `⋯` opens a bottom sheet with the same actions the desktop menu has,
built from one list so the two cannot drift apart.

**The invoice number opens the original document — on the Invoices & purchases
page, and nowhere else (2026-08-21, moved 2026-08-28).** A linked invoice number
is one whose purchase was created from an upload and still has its file in the
private `invoices` bucket (`invoice_uploads.storage_path`, with
`status = 'committed'` and `invoice_id` pointing at the purchase — `0010`).
Invoices typed in by hand have no file and stay plain text: a link that opens
nothing is worse than no link. `getProjectPurchases` sets `has_document` per
row — a boolean, never a URL. The link points at
`GET /api/projects/[id]/purchases/[pid]/document`, which resolves the purchase
to its stored file, signs a URL valid for 60 seconds and redirects (`no-store`),
404 when there is no file. **Signing at page load would be wrong**: a signed URL
expires, so every link on a list left open would be dead by the time it was
clicked — the same expiry problem the review screen has with its ten-minute
window (§8.2).

Until 2026-08-28 the link lived on the Expenses tab instead, on an invoice row's
*description*, fed by a `documentPurchaseIds` array on `getProjectBundle`. That
link and that array are both gone. The document now opens from exactly one
screen, from the invoice number itself — the thing you read off the paper you
are checking against. Both the desktop table and the mobile card link it, which
is the rule for that page: a column on only one of the two renders is invisible
to whoever is on the other device.

> ⚠️ `/api/projects/[id]/expenses` must return the invoices too, not just
> `expense_entries` — the tab refetches it after every change. When it returned
> the table alone, changing a status emptied the whole list, because with the
> spreadsheet import gone that table is empty.

**Edit from the Expenses tab returns to the Expenses tab (2026-08-20).** The
invoice Edit link carries `?returnTo=/projects/<id>?tab=expenses`, validated by
`lib/safeReturnTo.ts` (same-origin relative path only — anything else is
ignored) before `PurchaseForm` ever calls `router.push()` with it. Both Save
and Cancel honour it; it is `undefined` for `invoices/new` and the review
screen, so their redirect to the project's invoice list is unchanged. Tab
selection in `ProjectDetail.tsx` is otherwise component-local `useState`, so a
plain link back here always landed on Overview — it now reads a `?tab=` query
param once on mount (`initialTabFrom`), defaulting to Overview exactly as
before when the param is absent or not a real tab key. The redirect pairs
`router.push()` with `router.refresh()`, which is what makes the invoice show
its new values immediately: without it, the target route could be served from
the router cache with the pre-edit figures.

### 8.1 The Directory — supplier and item screens (Phase 1)

Four routes, added 2026-08-14, reading the §4.6 transaction core. They are
**read-only** — no form, no API route, no mutation of any kind; writes are
Phase 2's job. The two `[id]` screens are async Server Components with
`dynamic = "force-dynamic"` shipping **no client JavaScript**: the
expand/collapse on a purchase is a plain `<details>` element, not React state.

They are **cross-project by design**. A supplier and an item sit above the
project (§4.6), so these pages deliberately span every project at once — which
is why none of them shows a "project total".

> **The two lists became one destination, 2026-08-28.** Suppliers and Items were
> separate nav items holding the same kind of thing, so they are now the two
> halves of **Directory** — `/directory`, with `?view=suppliers|items`. The
> server half is `components/directory/Directory.tsx`; the client half is
> `DirectoryScreen.tsx`, on the same `PivotTable` shell as the project screen's
> Analysis tab. `/suppliers` and `/items` still work and render the same screen,
> because a great many links point at them.
>
> **The pivot lives in the URL here, and in component state on Analysis.** That
> is not an inconsistency: `getSuppliers()` and `getItems()` each read the whole
> transaction core, so only the half being looked at is fetched, and a fetch is
> a navigation. Analysis's four pivots all come out of one bundle that has
> already been loaded, so switching them costs nothing and needs no round trip.
>
> **What the scope control does and does not do.** It links to a project's
> Analysis pivot; it does **not** filter this page. `getSuppliers()` and
> `getItems()` return totals split by `entry_source` with no project
> attribution, so a real "this project" filter needs a new loader — a data
> change, not a presentation one. The reciprocal link ("Suppliers / Items across
> all projects") sits on the Analysis tab. Before this, the global page and the
> per-project view of the same data had no link between them in either
> direction, which is the actual fault the merge was for.

| Route | Loader in `lib/data.ts` | Shows |
|---|---|---|
| `/directory`, `/suppliers` | `getSuppliers()` | every supplier: records, total spend + owed, last purchase. Sorted by record **count** |
| `/suppliers/[id]` | `getSupplierBundle(id)` | four combined stat cards, then one statement table: date, invoice, project, gross, paid, balance, status, payment dates + methods, running total. Each row expands to its lines and payments |
| `/directory?view=items`, `/items` | `getItems()` | every **Materials**-category item (Labour items are filtered out): category, unit, times bought, suppliers, latest unit price, trend, last bought. Sorted by times bought |
| `/items/[id]` | `getItemBundle(id)` | the price timeline, oldest → newest across every supplier and project: date, supplier, project, invoice, qty, unit, unit price, line net, and the change vs the previous purchase |

The loaders follow `getProjectBundle`'s shape: a fixed handful of queries per
page, never one per row, and never a `.eq("user_id", …)` — RLS scopes it (§9).
`selectIn()` skips a round trip when the id list is empty.

**Three rules these screens are built on. Breaking any one of them makes the
numbers lie:**

1. **The `entry_source` split lives in the data, not on the screen
   (2026-08-21).** The loaders still group and total by `entry_source`, and
   the running total on `/suppliers/[id]` is still accumulated within a group
   — that is §5 applied to `purchases`, and it is what stops a double-count if
   a second dataset is ever imported alongside the invoices. But every one of
   these pages now *displays* one combined figure, via `combineTotals` in
   `components/purchases/totals.ts`, and the "diary" / "ledger" labels, badges
   and the `SourceNote` explaining them are gone. They described the retired
   dual-Excel import (§3.0); every purchase in the database today comes from a
   committed invoice, and invoice commit always writes `entry_source: 'diary'`
   (`lib/purchaseWrite.ts`), so there is currently nothing on the other side to
   double-count. The supplier list is still *sorted* on the record count rather
   than on money.
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
| `/api/projects/[id]/purchases/[pid]/document` | GET | 302 to a 60-second signed URL for the invoice's original file; 404 when none was stored. Signed on click, never at page load (§8) |
| `/api/expenses/[eid]/receipt` | POST | upload to `receipts` bucket |
| `/api/invoices/upload-url` | POST | signed upload URL + new `invoice_uploads` row (migration 0010). `project_id` optional since `0012` — a project-less file lands under `{user}/unassigned/…` |
| `/api/invoices/[id]` | GET | the upload row + a 5-min signed read URL for the file |
| `/api/invoices/[id]/extract` | POST | download → extract → resolve; always ends on a terminal status |
| `/api/invoices/[id]/commit` | POST | writes the reviewed invoice via `createPurchase`, into the project the review screen's `project_id` names (falling back to the upload's own); writes that project back onto the upload row |
| `/api/lookups/trades`, `/[id]` | GET/POST/PATCH/DELETE | trade lookups |
| `/api/auth/signout` | POST | sign out |
| `/api/gmail/connect` | GET | starts Google consent; sets the state nonce cookie and redirects (§8.3) |
| `/api/gmail/callback` | GET | verifies the nonce, swaps the code for a refresh token, upserts `gmail_accounts`, redirects to `/settings` (§8.3) |

---

### 8.3 The Gmail ingestion channel (phase 1 of 3, migration 0013)

Invoices arrive by email far more often than they arrive as a photograph, and
every one of them currently has to be saved out of Gmail and re-uploaded by
hand through the nav-bar panel (§8.2). This is the first of three steps towards
having them arrive on their own.

**What exists today is storage and consent only.** Nothing reads a mailbox.
There is no Pub/Sub subscription, no `watch` registration and no message
fetching — those are phase 2. Connecting an account changes no figure and
creates no upload.

#### The two routes

`/api/gmail/connect` mints a random `state`, puts it in an httpOnly `lax`
cookie, and redirects to Google's consent screen. `/api/gmail/callback` checks
the returned `state` against that cookie — a callback whose nonce does not match
is refused without the code ever being exchanged, which is what stops a crafted
link attaching somebody else's mailbox to this account — then exchanges the code
and upserts `gmail_accounts` on `(user_id, email_address)`. Both use
`requireUser()` and the ordinary server client. **There is no service-role usage
in this channel.**

`last_history_id` and `watch_expiration` are deliberately left null by the
callback; phase 2 owns them.

#### `lib/gmail/auth.ts`

Dependency-free — two POSTs and a GET against Google's documented endpoints, no
`googleapis` package. Env vars are `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, all server-only and
**never** `NEXT_PUBLIC_` — the secret would ship to the browser.

The rule that shapes the file: **access tokens are never stored.** Only the
refresh token is persisted. Access tokens are minted per call by
`getAccessToken()` and cached in-process for their lifetime minus 60s, so a
restart simply mints another and there is no stale-token path to reason about.

The consent URL uses `access_type=offline` **and** `prompt=consent`. Without
forced consent Google returns a refresh token on the *first* authorisation only,
and a reconnect then silently yields a credential that cannot be refreshed.
Scopes are `gmail.readonly` (read the message and its attachments) and
`gmail.modify` (phase 2 labels a message as processed so a re-drain does not
re-read it), in the exported `GMAIL_SCOPES` const.

`GmailAuthError` is thrown *only* on Google's `invalid_grant`. That distinction
matters: `invalid_grant` means the credential is dead and the account should go
to `needs_reauth`; anything else — a 5xx, a rate limit, a network blip — is
transient and must be retried, not reauthed.

#### The three new tables

| Table | What it holds |
|---|---|
| `gmail_accounts` | one row per connected mailbox: address, refresh token, `status` (`active` / `needs_reauth` / `paused`), plus the phase-2 watch fields |
| `gmail_events` | the durable in-tray for push notifications. The push endpoint writes a row and acks within seconds; a separate drain works them off. Unique on `(user_id, pubsub_message_id)` because Pub/Sub delivery is at-least-once and the same notification *will* arrive twice |
| `supplier_domains` | the declared list of sender domains that count as suppliers, normalised with the existing `public.norm_key` so `"Selco.co.uk"` and `" selco.co.uk "` are one domain. Anything from an undeclared domain is held rather than read automatically |

`last_history_id` and `gmail_events.history_id` are **text, not int**: Gmail
historyIds are 64-bit and already exceed `int4` on a busy mailbox.

#### New columns on `invoice_uploads`

`gmail_message_id`, `gmail_attachment_id`, `gmail_thread_id`, `from_address`,
`subject`, `received_at`, `file_hash`, and `source_channel` (`manual` | `gmail`,
defaulting to `manual`). Every one is nullable or defaulted, so **all rows that
existed before 0013 keep exactly the meaning they had** — a file a human chose
and uploaded.

**The dedupe key is `(user_id, file_hash)`, a partial unique index where
`file_hash is not null`.** It is the sha256 of the *bytes*, not the message id,
deliberately: the same invoice PDF routinely arrives twice — forwarded from a
colleague, or re-sent by the supplier after a query — and both copies carry
different message ids. Hashing the file is the only key that survives that. A
second partial unique index on `(user_id, gmail_message_id, gmail_attachment_id)`
is the cheaper, earlier guard: if we have already pulled this exact attachment
off this exact message, do not download it again to find out.

`invoice_uploads.status` gained one value, **`needs_triage`** — arrived from
Gmail from a sender whose domain is not in `supplier_domains`, so it is held for
a human rather than extracted automatically or quietly discarded. The five
existing values are unchanged, and the committed-must-have-a-project constraint
from 0012 was not touched.

The full status lifecycle, with where each state is visible:

| Status | Means | Where you see it |
|---|---|---|
| `needs_triage` | arrived by email from an undeclared sender; deliberately **not** read | the triage queue on `/invoices`, badged *"Waiting to be checked"*. The review screen says the same and links back to it. |
| `pending` | uploaded or triaged, waiting to be read | the upload queue; a rate-limited row also sits here. A Gmail-sourced one is on the "Invoices from email" list as *"Still reading"* |
| `processing` | extraction in flight | the upload queue; a Gmail-sourced one as *"Still reading"* |
| `extracted` | there is a proposal, waiting for a human | the review screen. A Gmail-sourced one is linked from the "Invoices from email" list, badged *"Ready to review"* |
| `failed` | extraction gave up; `error` says why | the review screen; retryable. A Gmail-sourced one is on the "Invoices from email" list, badged *"Couldn't be read"*, with the error shown inline |
| `committed` | accepted and written into `purchases` | the review screen says "Already saved". It **leaves** the "Invoices from email" list (2026-08-28) and appears on its project's Invoices & purchases page, where the invoice number opens the original document |

**Every Gmail-sourced state above has a screen.** That was not true until
2026-08-27: a `gmail` upload that extracted *successfully* appeared nowhere at
all, because the only list on `/invoices` filtered on `needs_triage`. See
"Seeing what arrived by email" below. `committed` is the one state whose screen
is not on `/invoices` — by design, since the work on it is done.

`needs_triage` is a Gmail-only state — a manually uploaded file never enters
it, because a human chose that file.

#### Known operational constraint — the 7-day expiry

While the Google Cloud consent screen is in **Testing** mode, Google expires a
test user's refresh token after **seven days, every time**. The connection will
therefore need re-establishing roughly weekly until the app is published in the
Google Cloud console. This is Google's rule and no amount of code works around
it. When it happens the credential fails with `invalid_grant`, the account is
set to `needs_reauth`, and the Gmail section of `/settings` shows "Needs
reconnecting" with a Reconnect link.

#### The Settings UI

`components/settings/GmailSection.tsx` is a Server Component under the trades
table on `/settings`. No connected account → a "Connect Gmail" button. One or
more → the address, the status, and how long ago the last notification arrived,
rendered as an age because the only question it answers is "is this still
alive?". Because 0013 is run by hand, the component treats a query error as
"the table does not exist yet" and says so plainly rather than crashing the
page.

That heartbeat covers only half the question — it says whether Gmail is still
*sending*, not whether anything is still *reading*. The other half is
`components/invoices/DrainHealth.tsx` on `/invoices`; see "Knowing the drain has
stopped" in §8.4.

---

### 8.4 Gmail ingestion, phase 2 — watch, push and drain

Phase 1 stored a credential. Phase 2 is what actually reads the mailbox. Three
routes and two libraries, on two schedules run by **two different schedulers**
— see "Two schedulers, not one" below.

| Route | Runs | Scheduled by | Guard | Does |
|---|---|---|---|---|
| `GET`/`POST /api/gmail/watch/renew` | daily, 03:17 | Vercel Cron (`vercel.json`) | `CRON_SECRET` bearer, **or** a signed-in session | re-registers `users.watch` on every `active` mailbox |
| `POST /api/gmail/push` | on every notification | nothing — Google calls it | Google OIDC token + `?token=` secret | writes one `gmail_events` row and returns 200 |
| `GET`/`POST /api/gmail/drain` | every 5 minutes | **cron-job.org**, over plain HTTPS | `CRON_SECRET` bearer, **or** a signed-in session pinned to its own mailboxes | history walk → attachments → Storage → `invoice_uploads`. `?backfill=1&days=N` rescans the label instead, ignoring the cursor and the event queue — see "Backfill: the way back" |

**Both scheduled routes export `GET` as well as `POST`, and this matters.** A
scheduler invokes a path with **GET** — this was true of Vercel Cron and is true
of cron-job.org; while they exported `POST` only, every scheduled invocation
answered 405 and nothing drained and no watch was ever registered or renewed.
Both verbs run the same handler and so go through the same `isCronRequest()`
check: the guard is on the work, not on the verb. `POST` is kept so a drain can
be triggered by hand and so the settings button can re-register a watch.

#### Two schedulers, not one

The drain wants to run every five minutes. **Vercel's Hobby plan allows daily
crons only**, and rejects the whole deployment — not just the entry — when
`vercel.json` asks for anything finer. So `vercel.json` now declares one cron,
the daily watch renewal, and the five-minute drain is triggered by an external
scheduler (cron-job.org) doing an ordinary HTTPS `GET` with the
`Authorization: Bearer $CRON_SECRET` header set by hand on the job. No auth
change was needed: `isCronRequest()` cannot tell the two callers apart, and does
not need to.

Two consequences worth knowing:

- **`CRON_SECRET` is now held by a third party.** Rotating it is a two-place
  edit — the Vercel environment variable *and* the header on the cron-job.org
  job. Change one without the other and every drain answers 401.
- **Keeping the renewal on Vercel is deliberate.** It is legal on Hobby, and it
  means `CRON_SECRET` is not the sole protection on the watch-renewal path.

The external scheduler is a **deployment dependency**: lose the cron-job.org
account and mail stops being read, with nothing broken anywhere in this repo to
say so. Its settings are recorded in the README so the job can be rebuilt.

#### The drain is partial by design

cron-job.org closes the connection at **30 seconds** and disables a job outright
after **15 consecutive failures**. A drain that occasionally took 35 seconds
would therefore quietly switch itself off. Two things keep it inside the window:

- **A 20-second soft budget** (`DRAIN_TIME_BUDGET_MS`). It is checked at the
  *top* of each account and each message, never part-way through one, so
  whatever has started always finishes. Exceeding it takes the same route a
  failed message takes: the claimed events go back to `pending` and **the cursor
  does not move**, so the next run re-walks the same window and the byte-level
  dedupe absorbs the repeat. `maxDuration = 60` stays as the hard backstop.
- **Halved per-run caps**: at most **12** events per account (was 25) and **15**
  messages per run (was 30).

Neither costs throughput. At 288 runs a day the schedule moves far more than the
caps ever asked it to, so a smaller batch simply means a leftover is picked up
five minutes later — and "slow run" stops being a *scheduler failure* and
becomes an ordinary partial run.

The one thing a time-out does **not** skip is labelling and extraction of the
uploads that run already created. It must not: the next run re-walks the same
messages, the dedupe recognises those attachments and skips them, and they would
never be queued for extraction again — they would sit at `pending` for ever.

#### The response body is counts, not detail

cron-job.org keeps only the first **64KB** of a response, so the drain answers
with a fixed-size summary rather than the per-account reports it used to return
(whose `errors` arrays grew with every message that misbehaved):

```json
{ "ok": true, "accountsProcessed": 1, "eventsProcessed": 3,
  "uploadsCreated": 2, "eventsRemaining": 0, "errors": 0,
  "partial": false, "ms": 4210 }
```

`partial` is true when either loop stopped on the time budget. The full
per-account detail is still written to the Vercel log whenever anything failed.

Status codes are unchanged and deliberately so. A wholesale failure — no
`CRON_SECRET`, no `GMAIL_INVOICES_LABEL_ID`, an unreadable `gmail_accounts`
table — is still a non-2xx, which is what makes cron-job.org's failure
notification fire. A single unreadable attachment is **not**: it is reported as
`ok: false` with an `errors` count inside a 200. Turning that into a 500 would
mean one permanently-bad attachment failing fifteen runs in a row and disabling
the schedule — precisely the outcome all of the above exists to prevent.

#### Knowing the drain has stopped

`components/invoices/DrainHealth.tsx` on `/invoices` answers the question the
settings heartbeat cannot. That heartbeat (§8.3) says whether Gmail is still
*sending*; it says nothing about whether anything is *reading*. Since the
schedule left Vercel, that gap is a real failure mode — cron-job.org disables a
job silently as far as this app is concerned, and everything else keeps working:
mail arrives, Pub/Sub pushes, `gmail_events` rows are written, and then nothing
drains them. Invoices would just stop appearing.

The evidence is the oldest `gmail_events` row still at `pending`. Under 20
minutes it is a quiet grey line ("2 emails waiting to be read, oldest 4 min
ago"); over 20 minutes — four missed runs — it turns amber and says the
scheduler may have stopped. No pending rows renders nothing at all, like the
triage queue beside it.

It reads through the **ordinary RLS-scoped server client**, not the service
client the drain uses, and adds no `.eq("user_id", …)`: the `own gmail events`
policy from 0013 already scopes it, so R3 holds (§2). One query returns both the
count and the oldest row, and `idx_gmail_events_status_created` covers exactly
that shape.

#### Seeing what arrived by email

`components/invoices/EmailInvoices.tsx` on `/invoices` lists every
`invoice_uploads` row with `source_channel = 'gmail'` **except `needs_triage`
and `committed`**, newest first — filename, subject, sender, received date,
status, and a link that depends on the status (review it, see why it failed, or
nothing while it is still being read). A `failed` row shows its `error` inline.

Two statuses are excluded, for opposite reasons. `needs_triage` belongs to
`TriageSection` above it, which renders those rows *with the buttons that act on
them*. `committed` is excluded because **the list is the outstanding queue**: an
invoice that has been reviewed and logged is finished, and leaving it here read
as one more thing needing attention on a list that then only ever grew. It used
to stay, on the reasoning that a saved row is the most reassuring thing on the
list; in use, the reassurance was not worth the noise. From the moment it is
committed the invoice lives on its project's **Invoices & purchases** page,
where its number opens the original document (§8, "The invoice number opens the
original document").

It exists because the pipeline used to end in a dead end. `TriageSection`
filtered on `needs_triage` and nothing else anywhere queried `invoice_uploads`
for a list, so an email invoice that was read **successfully** was invisible:
the review screen worked, and the only way to reach it was to fetch the
upload's UUID out of the SQL editor. Mail arrived, extracted correctly, and then
waited for a human who was never shown it.

Unlike `DrainHealth` and `TriageSection` beside it, **this section always
renders something.** Those two answer "is anything wrong?", where silence is the
correct answer. This one answers "did my email get here?", where silence is
indistinguishable from the bug it was written to fix — so an empty mailbox gets
one line saying so, pointing at `/settings`.

#### The `labelAdded` gap — why the first seven invoices vanished

On 2026-08-27 seven invoices were emailed in. All seven produced Pub/Sub
notifications, all seven `gmail_events` rows drained to `done` on the first
attempt with no errors, and **not one `invoice_uploads` row was created.**

The watch is registered on the invoices label (`labelIds: [labelId]`,
`labelFilterBehavior: "include"`), so it fires on *any* change to that label —
including the label being put on a message that was delivered earlier. But the
history walk asked Gmail for `historyTypes: ["messageAdded"]` only. A
`messageAdded` record exists only where the label was present **at delivery**,
i.e. where a Gmail filter applied it. Label a message by hand and the sole
record of it is `labelAdded`. So the walk saw an empty history, correctly filed
nothing, and — because the cursor advances on a clean run — moved
`last_history_id` straight past the invoice. Silently, seven times.

The walk now requests **both** types and folds `labelsAdded` message ids into
the same set. Those entries are filtered on the *added* label containing the
invoices label: Gmail's request-level `labelId` filter matches on the message's
labels, which would also admit the `processed` label this route adds itself at
step 5, and re-reading our own bookkeeping would mean re-downloading every
attachment already read on every run. (Harmless — the `file_hash` dedupe absorbs
it — but pointless.)

Two things made this invisible for as long as it was, and both are fixed:

- **The drain logged nothing on a successful run.** `console.error` fired only
  when `errorCount > 0`, and these runs were textbook successes. It now logs the
  per-account report on **every** run.
- **The response body had no `messages_seen`.** So a by-hand call could not
  distinguish "the history walk matched nothing" from "messages were found and
  every attachment was rejected by the MIME/size filter". The body now carries
  `messagesSeen`, `queuedForExtraction`, `triaged`, `skippedDuplicates` and
  `historyReset` alongside `uploadsCreated` — counts only, so the 64KB ceiling
  is in no danger.

Reading the result: `messagesSeen: 0` with `eventsProcessed > 0` means the walk
matched nothing. `messagesSeen > 0` with `uploadsCreated: 0` means the
attachments were rejected — PDF/JPEG/PNG/HEIC only, 5KB–15MB, and nothing that
`isEmbeddedImage()` judges to be a logo pasted into a signature.

That second reading is exactly what the *next* bug turned out to be.

#### The `Content-ID` trap — why the next five vanished too

Later the same day, with the `labelAdded` fix in hand, five more invoices went
the same way: 14 `gmail_events` rows all `done` on the first attempt, no errors
anywhere, and **zero** `invoice_uploads` rows with `source_channel = 'gmail'`.
This time the history walk was fine — `messagesSeen` would have been non-zero.
Every attachment was being thrown away one step later.

`collectAttachments` decided whether a part was a real attachment or an image
embedded in the body by asking whether it carried a `Content-ID` header, on the
reasoning that an inline logo has one and a genuine attachment does not. **The
second half of that is false.** Gmail's own compose window stamps a `Content-ID`
(and an `X-Attachment-Id`) on every file it sends, alongside an explicit
`Content-Disposition` saying the opposite. Read off one of the lost messages:

```
Content-Type: application/pdf; name="K8 document invoice-17047508.pdf"
Content-Disposition: attachment; filename="K8 document invoice-17047508.pdf"
Content-ID: <f_mtbbao5k0>
```

So every invoice sent from a Gmail account — which is every invoice this app had
ever been tested with — was classified as a signature logo and discarded. With
no candidates, the message was recorded as handled, the cursor advanced, and the
event was marked `done`. Another textbook-successful run that did nothing.

`isEmbeddedImage()` now reads **`Content-Disposition`**, which is the header
RFC 2183 defines for precisely this question: `inline` is an embedded image,
`attachment` is not. When the header is absent — some mailers omit it — it falls
back to the old `Content-ID` heuristic, but **only for `image/*`**, which is the
case it was really written for. A document with no disposition is now kept: a
stray file in the triage queue costs a click, a dropped invoice costs the whole
feature.

Measured against the five real messages before anything was written: the old
test kept **0 of 5**, the new one keeps **5 of 5**.

#### Backfill: the way back

Both bugs above were unrecoverable once they had happened, and for the same
structural reason. **Everything in the drain is driven by `gmail_events`**: no
pending row, no work, whatever is sitting in the mailbox. So a bug that files
nothing while reporting success strands that mail permanently — the cursor is
past it, the event says `done`, and nothing in the five-minute cycle will ever
look again.

The advice that used to live here — `update gmail_accounts set last_history_id
= null` — **does not work on its own**, and is withdrawn. It makes the next
drain take the 404 fallback, but only if a drain runs at all, and a drain with
no pending event returns immediately.

`GET|POST /api/gmail/drain?backfill=1&days=N` is the replacement:

- ignores the cursor **and** the event queue, and rescans the invoices label
  directly (`has:attachment newer_than:Nd`, default 7, capped at 90);
- **claims no notifications**, deliberately. It walks the label, not the
  history, so it never covers the window a pending event describes — an event
  it marked `done` would take that window down with it;
- **never writes the cursor.** The messages it finds are older than the cursor
  by definition, so the only thing it could do is move it backwards;
- does *not* exclude the `processed` label from the scan. A message this app
  labelled but failed to file is exactly what a backfill is for, and that is
  not hypothetical — the `Content-ID` bug stamped all five invoices as
  processed while filing none of them.

The `file_hash` dedupe is what makes it safe to run at any time: anything
already read is skipped.

The route now accepts **a signed-in user as well as the cron secret**, pinned to
that user's own mailboxes — the same split `/api/gmail/watch/renew` already
used, and for the same reason. That is what lets
`components/settings/RescanMailboxButton.tsx` put it on `/settings` as
**"Re-scan the mailbox"**, so recovery no longer requires someone who holds
`CRON_SECRET`. Its toast reports what was actually found ("no emails with
attachments", "everything had already been read", or a count now being read)
rather than saying "done" — a reassuring message that cannot tell success from
silence is what let both of these bugs run in the first place.

**The cursor is now forwards-only.** It is written through `maxHistoryId`
against its current value. This was a latent bug on the 404 fallback path too,
where the new cursor is whatever the scan happened to find and could easily be
behind where it already was — which would re-walk the same window on every tick
from then on.

**The first watch is registered by the OAuth callback**, not by the daily cron.
`/api/gmail/callback` calls `watch()` immediately after the credential upsert
succeeds. Before that it stopped at the upsert, so a freshly connected mailbox
had no Pub/Sub subscription — and therefore no notifications, and nothing to
drain — until 03:17 the next morning. The call is deliberately best-effort and
wrapped in try/catch: the credential is the valuable part and losing it means
going round the whole consent flow again, whereas a missing watch is one button
away. On failure the redirect still succeeds, carrying `?watch=failed`, and the
Gmail section of `/settings` says so in amber next to a **Register / refresh
watch** button that POSTs to the renew route.

#### Why push and drain are two different things

A Gmail notification carries **only** `{ emailAddress, historyId }`. Every
actual message, and every attachment, has to be fetched afterwards. Pub/Sub
gives a push endpoint **ten seconds** to acknowledge, and a history walk plus
two attachment downloads will not fit in ten seconds.

An un-acknowledged notification is redelivered. Under any load that becomes a
redelivery storm aimed at an endpoint that is already too slow — and Pub/Sub
keeps retrying for up to seven days before dead-lettering. So the push endpoint
does exactly two things: prove the caller is Google, and write the notification
down. `/api/gmail/drain` does the work later, at its own pace. The
`gmail_events` row is also the audit trail: what arrived, when, how many times
it has been attempted, and what went wrong if anything did.

The status code the push endpoint returns is part of the contract:

- **200** — durably recorded, *or* impossible to ever process (a mailbox nobody
  has connected, a malformed body). Both are acked; re-sending would not change
  the outcome.
- **401** — the caller is not Google. Nothing is recorded, and the response says
  nothing about which check failed.
- **5xx** — only for a genuinely transient failure (the database is down) that
  we actually want retried.

`/api/gmail/push` is **excluded from the middleware matcher**. It is a
machine-to-machine call with no cookies, so refreshing a Supabase session for it
is pure work on the one hot path that has a deadline.

#### Verifying the caller

`/api/gmail/push` is the only URL in this app reachable without a session, so it
is verified twice. `lib/gmail/oidc.ts` checks the `Authorization: Bearer` OIDC
token's **RS256 signature** against Google's published certificates, then its
`iss`, `exp`/`iat`, `aud` (must equal `GMAIL_PUSH_AUDIENCE`) and `email` (must
equal `GMAIL_PUSH_SERVICE_ACCOUNT`). The audience check is what stops a valid
Google-signed token minted for somebody else's service being replayed here.
Separately, the URL must carry `?token=` matching `GMAIL_PUSH_SECRET`.

Written against `node:crypto` rather than `google-auth-library`, for the same
reason `lib/gmail/auth.ts` is dependency-free: this is one JWKS fetch and one
RSA verification, and it is the security boundary — worth being able to read.

#### The R3 exception — the only place RLS is not doing the scoping

Rule R3 (§2) is that **no query filters by `user_id`**, because `auth.uid()`
does it. A cron request has no session at all, so `auth.uid()` is null and every
policy matches nothing. The three routes above therefore use
`createServiceClient()`, which bypasses RLS entirely, and:

- every read is keyed on the account (`.eq("account_id", …)`) or on an explicit
  `.eq("user_id", …)` taken from the `gmail_accounts` row;
- every write sets `user_id` explicitly from that same row;
- there is a comment at each such call site saying so.

Service-role usage stays confined to `app/api/gmail/{push,drain,watch/renew}`
and `lib/gmail/ingestExtract.ts`. **Nothing that runs under a user session gains
a `.eq("user_id", …)`** — R3 is unchanged everywhere else in the app.

#### Bypassing RLS is not the same as being allowed in

`service_role` skips every policy, but it still needs an ordinary Postgres
**GRANT** on each table — and until `0014_service_role_grants.sql` it had none,
on any table in `public`. Every migration from 0001 onwards granted to
`authenticated` only, and Supabase's automatic default privileges never covered
the fourth role here.

Nothing noticed for months, because nothing else uses the role: every screen
runs as `authenticated`, which has always had its grants. The three routes above
are the only code that assumes `service_role`, so they were the only things
broken — and they were broken from the day they shipped. The drain answered
`500 permission denied for table gmail_accounts` on every five-minute tick and
push answered 503 on every Pub/Sub delivery, while `/items` and `/dashboard`
returned 200 in the same log.

**Two failure modes that look nothing alike.** RLS with no matching policy
returns an empty result — silent, and indistinguishable from "no rows" (§11). A
missing grant returns Postgres **42501**, a hard refusal raised before any
policy is consulted. If a service-role route says *permission denied for table
X*, the answer is a grant, never a policy and never the key.

0014 also sets `alter default privileges … to service_role`, so a table added
by a later migration is covered without anyone having to remember. `anon` and
`authenticated` were not touched.

#### The claim is a compare-and-swap, not an advisory lock

Two drains reading one `last_history_id` would do the same work twice. The
usual fix is `pg_try_advisory_lock`, which is not available here: it lives in
`pg_catalog`, which PostgREST does not expose, and a *session*-level lock taken
over a pooled connection would be released on whichever connection happened to
serve the next request. So the mutex is the event claim itself —

```sql
update gmail_events set status='processing' where id = ? and status='pending'
```

— which returns a row to exactly one worker. The residual risk (two workers
walking history from the same cursor) is absorbed by 0013's two unique indexes:
a duplicate insert fails harmlessly rather than producing a second invoice.

#### The historyId 404 — build it, because it will fire

Gmail prunes history after roughly a week, sooner on a busy mailbox. Any gap
longer than that — a holiday, a broken watch, an account left paused — leaves
`last_history_id` unusable, and `history.list` answers **404**.

That is not an error to log; it is a state to recover from. `historyList()`
raises it as its own class, `GmailHistoryGone`, and the drain falls back to
`messages.list` with the invoices label and `has:attachment newer_than:7d`,
processes what it finds, and rebuilds the baseline from the newest message's
`historyId`. A null cursor (watch renewal has never run) takes the same path.
Without this the app does not degrade — it silently stops working.

If that scan finds **zero** messages — a quiet week — there is no message
`historyId` to rebuild from, so the cursor would stay null and the *next* tick
would 404 again and repeat the whole seven-day scan, for ever, on every tick.
The drain therefore asks Gmail where the mailbox is now (`users.getProfile`,
one call, read-only) and re-baselines from that. Failing to do so is not fatal;
the only cost is one repeated scan.

#### Which attachments are even considered

Walking the MIME tree, a part is a candidate only if it has a `filename` and an
`attachmentId`, its type is one of `application/pdf`, `image/jpeg`, `image/png`,
`image/heic`, it carries **no `Content-ID` header**, and its size is between
**5KB** and `GMAIL_MAX_ATTACHMENT_BYTES` (default 15MB).

The `Content-ID` test is what keeps a supplier's signature logo out of the
review queue — an inline image has one, a real attachment does not. The 5KB
floor catches the logos that slip through anyway; it exists to skip junk, not
to judge an invoice by its size. It was 20KB, which silently dropped genuine
single-page text-layer invoices from small suppliers — those are routinely
6–15KB — so it was lowered. The ceiling is real rather
than nominal: Gmail returns attachments base64-encoded inside JSON, so a 20MB
file is ~27MB on the wire and both the encoded and decoded copies are in memory
at once.

#### De-duplication is on the file's bytes

Two checks, cheap one first:

1. `(user_id, gmail_message_id, gmail_attachment_id)` — have we already pulled
   this attachment off this message? Skips the download entirely.
2. `(user_id, file_hash)` — the sha256 of the bytes.

The second is the one that matters. **The same invoice PDF routinely arrives
twice**: forwarded on by somebody, or re-sent by the supplier after a query.
Each copy is a different email with a different message id, and only the bytes
are the same. Keying on the message would file the same invoice twice, and
nothing on screen would say so.

#### Extraction is gated on the sender's domain

The sender's domain, normalised with the same rule as `public.norm_key`, is
compared against `supplier_domains` (sub-domains count; the match requires a `.`
boundary, so `notselco.co.uk` never matches `selco.co.uk`).

| Sender | `invoice_uploads.status` | Extraction |
|---|---|---|
| declared supplier domain | `pending` | runs, then `extracted` or `failed` |
| anything else | `needs_triage` | **does not run** |

An unknown sender sitting in a triage list costs nothing. Auto-reading it costs
a Gemini call and, worse, puts a stranger's attachment into the review queue
looking exactly like an invoice.

#### How `supplier_domains` gets filled — the triage queue

Migration 0013 created `supplier_domains` and seeded it with **no rows**, and
for a while nothing anywhere wrote to it. The gate above was therefore
permanently shut: `known` was false for every sender, every attachment landed
as `needs_triage`, and **no invoice was ever extracted**. There was also no
screen that listed triaged uploads, so mail arrived, stored correctly, and was
invisible.

The write path is the triage queue on **`/invoices`**
(`components/invoices/TriageSection.tsx`). It lists every upload at
`needs_triage`, newest first — filename, subject, sender, received date, size —
and renders nothing at all when the queue is empty, so an ordinary visit to
that screen is unchanged. Each row offers two answers, both of which POST to
`/api/invoices/[id]/triage`:

| Button | Body | Effect |
|---|---|---|
| **Trust this sender & extract** | `{ trustSender: true }` | inserts the sender's **domain** (never the full address) into `supplier_domains`, then extracts. Every future invoice from that domain skips triage. |
| **Extract once** | `{ trustSender: false }` | extracts this one and records nothing. The next invoice from that sender queues again. |

The table therefore seeds itself from decisions the owner actually makes, one
sender at a time, rather than from a list of domains guessed up front — and the
domain recorded is the one invoices genuinely arrive from, sending sub-domains
and mail relays included.

The route runs under a real session, so RLS scopes it and no read filters by
`user_id` (R3). It reuses `extractQueued()` from `lib/gmail/ingestExtract.ts`
rather than repeating the extract flow, so a triaged invoice lands in exactly
the state an auto-extracted one does and always ends on a terminal status.
`ux_supplier_domains_user_domain` is an *expression* index on
`(user_id, public.norm_key(domain))`, which PostgREST's `on_conflict` cannot
name, so the insert is made idempotent by hand: look first, insert if absent,
and treat a `23505` from a concurrent insert as success.

The normalisation rules the gate reads with and the triage route writes with
live in one file, `lib/gmail/domains.ts`, precisely so they cannot drift: if
triage stored `"Selco.co.uk "` and the gate normalised to `"selco.co.uk"`,
trusting a sender would appear to work and the very next invoice from them
would land in triage again.

Extraction runs **three at a time** — Gemini's per-minute quota is the real
ceiling on ingestion, not Gmail's. A 429 is retried twice, 4s then 12s apart,
and if it still will not go through the row is left at **`pending`** (never
`failed`) with an error beginning *"Rate limited by the extractor"*. That
distinction is the whole point: "we ran out of quota, this will be picked up
again" and "this document cannot be read" look identical on screen otherwise,
and only one of them wants a human.

#### `lib/gmail/ingestExtract.ts` — why the drain does not POST to the extract route

It cannot. `/api/invoices/[id]/extract` begins with `requireUser()`, which reads
the Supabase session out of **cookies**; a cron request has none and no way to
mint one, so every such POST would be a 401.

So the drain runs the same work in-process: the same `extractInvoice()`, the
same re-check against `InvoiceExtractionSchema`, the same four columns written
(`status` / `extraction_raw` / `extraction_method` / `page_count`), and the same
rule that a row is never left sitting at `processing`. The row lands in exactly
the state a hand-uploaded file's row lands in, so **the review screen and the
commit route cannot tell the two apart** — which is the point. A Gmail-sourced
invoice goes through the identical extract → review → commit path, and a human
still checks every one against the original before anything is committed.

`resolveSupplier()`/`resolveItems()` are deliberately not called: they are
read-only, and the review page re-resolves both itself rather than trusting what
the extract route saw.

#### The cursor moves last

`last_history_id` and `last_drain_at` advance only after **every** row in the
batch is durably written. If any message in the batch failed, the events are put
back to `pending` with the error recorded and the cursor is left exactly where
it was — the next tick re-walks the same window, which the de-duplication makes
harmless. A cursor moved early loses those messages permanently. Events that
have been attempted five times are marked `failed` and stop being claimed.

Handled messages are stamped with `GMAIL_PROCESSED_LABEL_ID` so a human looking
at the mailbox can see what has been read. Adding that label does not touch the
invoices label, so it cannot trigger a fresh notification.

#### Environment

`GMAIL_PUBSUB_TOPIC`, `GMAIL_PUSH_AUDIENCE`, `GMAIL_PUSH_SERVICE_ACCOUNT`,
`GMAIL_PUSH_SECRET`, `CRON_SECRET`, `GMAIL_INVOICES_LABEL_ID`,
`GMAIL_PROCESSED_LABEL_ID`, `GMAIL_MAX_ATTACHMENT_BYTES` — all server-only, all
documented in `.env.local.example`. `CRON_SECRET` **fails closed**: unset means
the drain and renew routes refuse every request, rather than accepting all of
them.

---

## 9. Auth and RLS

- `middleware.ts` runs `updateSession` on every non-static path to refresh the
  Supabase session cookie.
- Route Handlers use the **server** client (`lib/supabase/server.ts`), never the
  browser client.
- `createServiceClient()` (service-role key) is for storage MIME validation,
  signed URLs, **and the three cron/push Gmail routes** — see §8.4. Nowhere
  else.
- `service_role` bypasses RLS but still needs table **grants**;
  `0014_service_role_grants.sql` gives it them, and sets default privileges so
  new tables inherit them. A missing grant is a hard `42501 permission denied`,
  not the silent empty result a missing policy gives — see §8.4.
- Every table has one policy: `for all to authenticated using (true) with check
  (true)`, named `shared workspace`. All sixteen of them, set by `0015`.
- **No query under a user session filters by `user_id`.** Scoping is entirely
  implicit. The one documented exception is the Gmail push and drain path,
  which has no session for `auth.uid()` to return and therefore sets `user_id`
  explicitly on every write — §8.4.

### 9.1 One shared workspace (since `0015`)

Until `0015` (2026-08-27) the policy on every table was
`for all using (auth.uid() = user_id) with check (auth.uid() = user_id)` —
a **multi-tenant** rule giving each account its own private copy of the app.
46 Glenferrie Road is one renovation with one set of books, so when the owner
added a friend in the Supabase dashboard that friend signed in successfully and
saw *nothing*: every row belonged to `admin@pk.com`'s uuid and RLS filtered all
of them out. Nothing was broken; the policy was doing what it said.

`0015` replaced all sixteen with `to authenticated using (true)`. **Signing in
is now the whole of the authorisation model.** Sign-up is still disabled and
users are still created by hand in the Supabase dashboard, so "anyone signed
in" means "anyone the owner deliberately let in" — and any of them can delete
the project, with no undo (§11).

`to authenticated` is what stops this being a public database: the `anon` role
a signed-out browser uses is not granted the policy and still matches no rows.

Three things `0015` had to move with the policies, none of them obvious:

- **Storage.** Both private buckets were laid out as `{user.id}/…` with
  policies keyed on `storage.foldername(name)[1] = auth.uid()::text`. Sharing
  the rows without the files would have been the worst outcome: a friend sees
  an invoice in the list, clicks it, and `createSignedUrl` — which runs under
  *their* session — is refused. SELECT and DELETE are now shared; **INSERT is
  deliberately still own-folder**, because nothing in the app writes anywhere
  else and the layout stays predictable.
- **`trade_lookups`.** `trg_seed_trades` seeds 13 default trades per new
  account (§11, step 3). Shared, the second person to sign in would have made
  the Trade dropdown 26 entries long. The trigger now seeds **only when the
  table is empty**, and a global unique index on `lower(btrim(name))` keeps
  the list one list.
- **`supplier_domains`.** The drain used to read it with
  `.eq("user_id", account.user_id)`. But `/api/invoices/[id]/triage` stamps a
  newly trusted domain with whoever pressed the button, who is not necessarily
  the person whose mailbox is connected — so a friend's triage decision would
  never have reached the gate and that supplier would land in triage for ever.
  The drain now reads **every** row, and a global unique index on
  `norm_key(domain)` keeps one row per domain.

`user_id` itself is untouched everywhere — every column, index, FK and unique
constraint, and every insert still stamps its creator. It is now **provenance**
(who added this expense), not permission. Its `on delete cascade` hazard is
unchanged and, if anything, sharper: deleting a *friend's* auth user now
destroys the work that friend did.

**An empty result is ambiguous** — it means either "no rows" or, before `0015`,
"rows owned by a different user". This exact ambiguity caused a real incident.
See §11.

---

## 10. Validation

Runs **both** client-side and server-side from the same file,
`lib/validation.ts`.

- `validateProject` — name required, ≤ 200 chars; `target_budget ≥ 0`; status
  in the allowed set.
- `validateExpense` — `week_number` a positive integer; description required,
  ≤ 200 chars; category in the allowed set; all five amounts ≥ 0;
  **`vat_rate` one of `VAT_RATES` — 0, 5 or 20**; status and payment method in
  their sets.
- `validatePurchase` — the header, plus every line and payment. On a line,
  **a blank `vat_rate` is its own error** ("Pick the VAT rate printed on the
  invoice"), separate from an out-of-set one: the invoice review screen leaves
  the box empty when the document printed a rate the CHECK will not take, and
  a blank that silently saved as 0% is exactly the bug §8.2 describes.
- `lib/expense.ts` → `buildExpensePayload()` normalises a form body into a DB
  payload — coerces the six numeric fields, maps `""` → `null`, defaults
  `status` to `Planned`.

These mirror the DB CHECK constraints. If you change a constraint, change both.

### 10.1 Non-blocking warnings in the expense form

Separate from validation: `components/forms/ExpenseForm.tsx` computes five
advisories that **never block saving**. They exist to catch mistakes at entry
time rather than in a report weeks later. All are pure `useMemo` over props —
no DB round-trip.

| Warning | Fires when | Rendered |
|---|---|---|
| `lastPriceHint` | Materials, description matches a past purchase, no unit cost typed yet | grey box: what it cost last time |
| `priceWarning` | as above, plus a unit cost is entered | red / green / grey / amber box with `± %` vs last purchase, or "unit → unit — check pack size" |
| `duplicateWarning` | same normalised description **and** same week **and** actual within £0.005 of an existing non-cancelled entry | amber, under Description |
| `overpaidWarning` | `paid_amount − actual_amount > 0.005` | amber, replaces the Amounts hint |
| `unitMismatch` | Materials, `qty > 0` and `unit_cost > 0` and `\|qty × unit_cost − actual\| > 0.01` | amber, with a one-click fix |

`duplicateWarning` uses `priceKey()` from `lib/summary.ts` — the same
normalisation the Price Tracker groups on, so the two always agree on what
counts as "the same item".

**`lastPriceHint` and `priceWarning` read `buildMaterialPriceIndex()`
(`lib/purchases.ts`), not `priorEntries` alone (2026-08-20).** The spreadsheet
import that used to fill `expense_entries` was removed on 2026-08-14, so
`priorEntries` alone has nothing left to compare against for most projects.
`buildMaterialPriceIndex()` merges `priorEntries` (hand-entered diary rows)
with this project's `invoiceLines` (real per-line invoice prices) into one
most-recent-observation-per-material lookup, keyed the same way
`priceKey()`/`normaliseName()`/`public.norm_key()` already agree on. It
excludes cancelled rows and the ledger side on both inputs, and drops any
price `<= 0`.

`expense_entries` has no `unit` column, so the typed unit cost is always
compared with `unit: null` via the existing `comparePrice()` (also
`lib/purchases.ts`, the same function `PurchaseForm.tsx` uses). Its own rule —
a known unit never compares equal to an unknown one — means a match against
another unit-less observation (i.e. another diary row) still shows a
percentage, while a match against a priced invoice line with a recorded unit
correctly suppresses the percentage and shows the "check pack size" message
via `PriceMoveBadge` instead of inventing a number across two different units.

**`priorEntries` and `invoiceLines` must both be passed in, or the price
warnings silently do nothing** — `invoiceLines` is a required prop precisely
because a missing one was the original bug (it used to be possible to forget
it with no compiler error). Both call sites pass both: `ExpensesTab.tsx`
(`entries` + `invoiceLines`, both from `ProjectDetail`'s `getProjectBundle`
load) and `AddExpensePanel.tsx` via `expenses/new/page.tsx`
(`bundle.entries` + `bundle.invoiceLines`). `duplicateWarning`,
`overpaidWarning` and `unitMismatch` are unchanged and still read
`priorEntries` only.

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

### 10.3 The Trade field — `components/forms/TradeSelect.tsx` (2026-08-20)

Shared by `ExpenseForm.tsx` and `PurchaseForm.tsx` (which covers manual
invoice entry, invoice edit and the post-extraction review screen — one
component, three callers). A `<select>` populated from `trade_lookups`, plus
a `+ Add new trade` option that reveals an inline name field and a Save
button without leaving the form — it `POST`s `/api/lookups/trades`, and on
success appends the new row to that form's own copy of the list and selects
it. A duplicate name (the table's `unique (user_id, name)`) comes back as the
route's existing 409 and is shown under the field, not as a crash or a
silent no-op.

**Still stores a plain string, exactly as before.** There is no FK from
`expense_entries.trade` or `purchases.trade` to `trade_lookups.id` — matching
is by convention only — so this select needed no migration and no backfill.

**A row whose trade isn't in the list keeps it.** Editing an entry typed
before this select existed (or whose lookup has since been renamed or
deleted) shows its current value as a selected option marked "(not in
list)", rather than silently blanking the field — the value only changes
once the user picks something else.

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
3. Beware the decoy: `trg_seed_trades` used to give *every* fresh account 13
   trade lookups immediately, so "some data exists" was misleading. Since
   `0015` it seeds only when `trade_lookups` is completely empty — which is
   exactly the state a wiped database is in, so the decoy is still there on
   the one occasion it matters most.
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
| `0010_invoice_upload.sql` | `invoice_uploads`, supplier VAT number / address, pg_trgm + the two `match_*` RPCs. Additive and re-runnable | ⚠️ run status not recorded here — the upload and review screens only work once it has been run; see `updates.md` |
| `0011_vat_reduced_rate.sql` | widens the `vat_rate` CHECK on **both** `expense_entries` and `purchase_lines` from `(0,20)` to `(0,5,20)`, so a reduced-rate invoice can be stored as the rate it prints (§8.2). Drops whatever CHECK on those tables mentions `vat_rate`, whatever it is named, and re-adds a named one — re-runnable. Cannot invalidate a row: every existing row holds 0 or 20, so no §13 figure moves | ⬜ **not yet run** |
| `0012_upload_before_project.sql` | makes `invoice_uploads.project_id` **nullable**, so an invoice can be uploaded before anyone has said which job it belongs to (§8.2), plus a CHECK that a `committed` upload must still have one. Re-runnable, only widens what is allowed, and raises rather than commits if the column is still NOT NULL afterwards. No §13 figure moves | ✅ **run** — 0013 asserts this file's constraint exists and committed, so it was already in place by 2026-08-25 |
| `0013_gmail_ingest.sql` | Gmail ingestion phase 1 (§8.3): `gmail_accounts`, `gmail_events`, `supplier_domains`, eight new nullable/defaulted columns on `invoice_uploads` with the `file_hash` dedupe index, and one widened CHECK adding `needs_triage` to `invoice_uploads.status`. Reuses `norm_key()` from 0008. Additive and re-runnable; every existing row stays valid and no §13 figure moves. Raises rather than commits if the widened CHECK did not take or if 0012 was never run | ✅ **run** — 2026-08-25, per the banner in the file; confirmed live on 2026-08-27 by `gmail_events` rows draining normally |
| `0014_service_role_grants.sql` | gives `service_role` full privileges on the tables, views, sequences and functions in schema `public`, plus a default-privileges rule so tables created later are covered. Fixes a hard `42501 permission denied` — **not** an RLS failure — that had broken every Gmail route since the feature shipped: the drain 500'd every five minutes and push 503'd on every delivery, because `service_role` had never been granted anything and only the three machine-to-machine Gmail routes use it (§8.4, R3). `anon` and `authenticated` are deliberately untouched. No data, policy or schema change; no §13 figure moves. Raises rather than commits if any of the four Gmail tables is still refused | ✅ **run** — 2026-08-27. Confirmed by seven `gmail_events` rows being claimed and marked `done` through `createServiceClient()`, which was a hard refusal beforehand |
| `0015_shared_workspace.sql` | turns the app from one-tenant-per-user into **one shared workspace** (§9.1): all sixteen `own …` policies become one `shared workspace` policy, `for all to authenticated using (true) with check (true)`. Storage SELECT/DELETE on both private buckets become shared too (INSERT stays own-folder); `trg_seed_trades` now seeds only into an empty table; duplicate `trade_lookups` and `supplier_domains` are collapsed and given global unique indexes. `user_id` columns, indexes and inserts are all untouched — the column becomes provenance rather than permission. No expense data is touched and no §13 figure moves. Re-runnable, and raises rather than commits if any table is still on the old policy | ⬜ **not yet run** |

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

> ⚠️ **Historical as of 2026-08-20 — read this first.** The owner has since
> **removed the spreadsheet-imported data**, because too many of its rows
> recorded a total with no quantity and no unit price, which is exactly what the
> Price Tracker needs (§3.1). The project is being rebuilt from invoices, one at
> a time, and `expense_entries` is empty or nearly so.
>
> Everything below therefore describes the app **as it was under the
> spreadsheet import**, and is kept as the record of what that dataset
> contained — not as a description of what the screens show today. It is no
> longer a regression baseline; there is nothing to regress against until enough
> invoices are in to make one. When there are, replace this section rather than
> appending to it.

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
> As of **2026-08-20**, `getItems()` excludes `category === "Labour"` rather
> than requiring `category === "Materials"`. The stricter test was hiding every
> item an uploaded invoice created: the extractor sets no category, so those
> items are null, and `/items` reported "no items" while the lines sat in the
> database. Labour-category items (subcontractor names seeded by `0008` the same
> way) are still excluded, which was the point of the 2026-08-17 filter. The
> merchant-as-item problem above is unchanged for the seeded Materials rows.

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
