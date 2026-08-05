# about.md — RenovaTrack reference

**Read this before changing anything in this project.**

This file explains what exists (tables, views, screens) and exactly how every
number on every screen is calculated. It is the map. `updates.md` is the history.

Last verified: 2026-08-05, against migrations 0001–0006.

---

## 1. What this is

RenovaTrack — a renovation cost tracker for **46 Glenferrie Road, St Albans,
AL1 4JU**. It replaces two spreadsheets the owner was keeping by hand.

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
   `materials_cost`, `remaining`.
2. **Never sum `diary` and `ledger` rows together.** They overlap. See §5.
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
Two spreadsheets (repo root)          scripts/build_import_sql.py
  File 1: 46_Glenferrie_Rd_..._Template.xlsx  ──┐
          "Week-by-Week Plan" sheet            │
  File 2: Renovation_Cost_Tracker-1.xlsx  ─────┤
          "Trades & Labour" + "Materials..."   │
                                               ▼
                              supabase/migrations/0005_reimport_data.sql
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

### The two source spreadsheets

| | File 1 | File 2 |
|---|---|---|
| Filename | `46_Glenferrie_Rd_Renovation_Spend_Tracker_Blank_Template.xlsx` | `Renovation_Cost_Tracker-1.xlsx` |
| Sheets | `Week-by-Week Plan`, `Summary`, `Lookups` | `Dashboard`, `Trades & Labour`, `Materials & Suppliers`, `Remaining` |
| Becomes | 40 `diary` rows, weeks 1–15 | 96 `ledger` rows + 16 trade lookups |
| Totals | actual £42,411.81 ex-VAT / £43,686.17 incl-VAT | quoted £98,932.12 |

These files are the **source of truth** for rebuilds. Do not delete them.

**File 1 quirks you must know:**

- The `Status` column reads `Planned` on **all 40 rows**. It carries no payment
  information. The real payment marker is the **`Paid Date`** column.
- Paid dates are hand-typed free text: `Friday 27/2`, and once `FRIDAY 10/4`.
  Day/month, weekday name, no year. `resolve_written_date()` in
  `build_import_sql.py` picks the year by matching the weekday — all seven
  distinct dates land on the stated weekday only in **2026**.
- Rows with a paid date: 20 (weeks 1–7). Rows without: 20 (weeks 8–15).

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

---

## 5. `source` splits the app in two — the single biggest trap

`expense_entries.source` decides which half of the app a row belongs to.

| | `diary` | `ledger` |
|---|---|---|
| Comes from | File 1, plus anything added in-app | File 2 import only |
| Rows | 40 (weeks 1–15) | 96 (weeks 16+) |
| Appears in | **Expenses tab** and **all Overview analytics**, **Dashboard cards** | **Trades & Labour**, **Materials & Suppliers**, **Price Tracker** |
| Money | £43,686.17 actual incl-VAT | £98,932.12 quoted |

**They overlap.** The ledger is a second record of much of the same spend.
`43,686.17 + 98,932.12 = 142,618.29` is a meaningless number — it is the
double-count. A raw `sum(actual_amount)` across the table is not a project total.

**Where the filter lives** — every screen that reports *project spend* must
apply it:

- `components/project/ProjectDetail.tsx:73` — `diaryEntries`, feeds Overview
- `components/project/ExpensesTab.tsx:66` — feeds the Expenses list
- `app/(app)/dashboard/page.tsx` — feeds the dashboard cards
  *(added 2026-07-22; its absence was a real bug — the card read 144%)*

Trades / Materials / Prices deliberately use the **full** entry set.

> ⚠️ **Known inconsistency.** The API summary routes
> (`app/api/projects/[id]/summary/`, `…/summary/by-week`, `…/summary/by-category`,
> `…/export/excel`, `…/export/pdf`) pass **unfiltered** `bundle.entries` into
> `buildSummary`. They therefore return the double-counted figure, unlike the UI.
> Nothing in the app currently consumes them, but the **Excel and PDF exports do**
> — so exports do not match the screen. Not yet fixed.

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
| `remaining` | `actual_amount − paid_amount` | 30 |

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
| **Total Quoted** | `total_quoted` | `Σ quoted_amount` — **ex-VAT** | 26 |
| **Actual Total** | `forecast_total` | `Σ total_incl_vat` — i.e. **incl-VAT** | 27 |
| **Variance vs Quote** | `variance` | `forecast_total − total_quoted` | 30 |
| **Paid to Date** | `paid_to_date` | `Σ paid_amount` — **ex-VAT** | 28 |
| **Remaining to Pay** | `remaining_to_pay` | `forecast_total − paid_to_date` | 41 |
| **Weeks Tracked** | `weeks_tracked` | count of **distinct** `week_number` | 32 |
| *(not shown)* | `contingency_amount` | `max(variance, 0)` | 31 |
| *(not shown)* | `forecast_plus_contingency` | `forecast_total + contingency_amount` | 39 |

Rendered by `components/project/OverviewTab.tsx:57–85`.

**Header "% of budget"** — `ProjectDetail.tsx:89` —
`round(forecast_total / target_budget × 100)`.

> ⚠️ **Two VAT mismatches are baked into these cards.** Both are pre-existing.
> 1. `total_quoted` is ex-VAT but `forecast_total` is incl-VAT, so **Variance
>    vs Quote includes the VAT** and overstates the overrun.
> 2. `paid_to_date` is ex-VAT but is subtracted from an incl-VAT total, so
>    **Remaining to Pay carries the VAT of rows already paid**.
>
> Fixing either changes headline figures — do not "tidy" it without asking.

> ⚠️ **Target Budget and spend come from different datasets.** Budget =
> File 2 ledger quoted; spend = File 1 diary actual. The percentage is not
> "% of the job done"; it compares two spreadsheets that overlap by an unknown
> amount. Both numbers are individually correct; the ratio is soft.

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

**There are no SQL views or materialized views.** `grep` for `create view`
across `supabase/` returns nothing.

Everything view-like is a **TypeScript function in `lib/summary.ts`**, computed
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
4. **Rebuild from the spreadsheets.** Set `USER_ID` at the top of
   `scripts/build_import_sql.py` to the current UUID, run
   `python3 scripts/build_import_sql.py`, then run the regenerated
   `supabase/migrations/0005_reimport_data.sql` in the SQL editor.

`0005` is **re-runnable** — it deletes the prior import of the project first.

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
| `0005_reimport_data.sql` | full rebuild from both spreadsheets. **Generated** by `scripts/build_import_sql.py` — do not hand-edit. Idempotent | ✅ |
| `0006_mark_paid_entries.sql` | marks the 20 diary rows with a paid date as `Paid`. **Generated** by `scripts/gen_mark_paid_sql.py`. Idempotent; aborts unless exactly 20 rows match | ✅ |

`0005` and `0006` are **generated files**. Edit the Python scripts and
regenerate — never hand-edit the SQL.

### Scripts

| Script | Reads | Writes |
|---|---|---|
| `scripts/build_import_sql.py` | both spreadsheets | `0005_reimport_data.sql` |
| `scripts/gen_mark_paid_sql.py` | File 1 (via `build_import_sql`) | `0006_mark_paid_entries.sql` |

---

## 13. Current figures (2026-07-22)

Project `46 Glenferrie Road`, after `0006`:

| | |
|---|---|
| Target Budget | £98,932.12 |
| Total Quoted | £42,411.81 |
| Actual Total (incl VAT) | £43,686.17 |
| Variance vs Quote | £1,274.36 over |
| Paid to Date | £13,273.40 |
| Remaining to Pay | £30,412.77 |
| Weeks Tracked | 15 |
| Budget used | 44% |
| Diary rows | 40 (20 Paid, 20 Planned) |
| Ledger rows | 96 |

Use these as a regression baseline. If a change moves one of them, that should
be intentional and recorded in `updates.md`.

---

## 14. Before you change anything — checklist

1. Read this file and the last few entries in `updates.md`.
2. Ask: does this touch a **diary/ledger** boundary? Re-read §5.
3. Ask: am I about to store a **computed total**? Don't — §2.
4. Ask: does this need a **migration**? If so, it must be run by hand in the
   Supabase SQL editor, and you must say so.
5. If the SQL is generated, edit the **Python script**, not the `.sql`.
6. Run `npm run build` (or `npx tsc --noEmit`).
7. Check the §13 figures still hold, or explain why they moved.
8. **Add an entry to `updates.md`.** This is mandatory.
