# RenovaTrack — Project Knowledge Base

**Purpose of this file.** A portable, self-contained description of RenovaTrack:
what it is, how it is built, every rule that holds it together, what has gone
wrong historically and why, and what state it is in. It is written to be handed
to a *different* project as background for planning — you should be able to
understand and reason about this system without opening the repository.

**Snapshot date:** 2026-08-20. **Written from:** the repo at commit `9970b90`
plus uncommitted working-tree changes (see §14).

Companion documents inside the repo: `about.md` (the deep reference, ~1,400
lines), `updates.md` (chronological change log, oldest first), `CLAUDE.md`
(working rules for AI agents), `README.md` (setup).

---

## 1. What the product is

RenovaTrack is a **renovation project cost tracker**. It was built to replace a
hand-maintained Excel spend tracker for one real building job — *46 Glenferrie
Road, St Albans, AL1 4JU* — and answers four questions:

1. What has this job cost so far, and what is still owed?
2. Who has been paid, and who is owed what?
3. What did each *item* cost, and is that price going up?
4. Where did each number come from — which document, which line?

It is **single-user in practice** (`admin@pk.com`). Public sign-up is disabled;
users are created by hand in the Supabase dashboard. It is nevertheless built
multi-tenant: every table is row-level-security scoped by `user_id`.

### Product evolution in one paragraph

It started as a spreadsheet importer: a Python script turned the owner's
week-by-week Excel plan into rows in one flat table (`expense_entries`), and
every screen summed that table. That model could report *totals* but not
*prices*, because the spreadsheet recorded a cost per week-row and almost never
a quantity or a unit price. So a **transaction core** was added — supplier,
item, purchase (document), purchase line, payment — and then an **invoice
ingestion pipeline** (photograph or PDF → LLM extraction → human review → saved
purchase). As of 2026-08-20 the owner has **removed the spreadsheet-imported
data entirely** and is rebuilding the project one invoice at a time. The five
analysis screens were rewritten the same day to read invoice lines instead of
the (now empty) expense table.

That arc — *flat imported totals → structured documents and lines* — is the
single most important thing to understand about the codebase. Both models are
still present, and which one a screen reads determines what it can say.

---

## 2. Tech stack and environment

| Layer | Choice |
|---|---|
| Framework | Next.js 14, App Router, Server Components by default |
| Language | TypeScript (strict); no test suite |
| Styling | Tailwind CSS 3 |
| Database / Auth / Storage | Supabase (Postgres 15+, Supabase Auth email+password, Storage) |
| Charts | Recharts |
| PDF export | `@react-pdf/renderer` |
| Excel export/import | `xlsx` (SheetJS) |
| Invoice extraction | Google Gemini via `@google/genai`, model `gemini-3.6-flash` |
| PDF text layer | `unpdf` (dynamic import; wraps PDF.js) |
| Runtime validation | `zod` v4 (only for LLM output) |
| Hosting | Vercel |

**Commands**

```bash
npm run dev      # dev server on :3000
npm run build    # production build — the only full typecheck, and the de-facto test suite
npm run lint     # next lint
npx tsc --noEmit # faster typecheck-only pass
```

**Environment variables** (`.env.local`, template in `.env.local.example`)

| Var | Scope | Use |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | browser + server client |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | storage MIME validation, signed URLs. Never exposed to the client |
| `GEMINI_API_KEY` | **server only** | invoice extraction. Never prefixed `NEXT_PUBLIC_` |

**Migrations are applied by hand.** There is no migration CLI. Each file in
`supabase/migrations/` is pasted into the Supabase SQL editor and run manually,
in filename order. *Writing a migration file does not apply it* — this has
caused real confusion and every migration file carries a run-status note.

---

## 3. Repository map

```
app/
  (app)/                     authenticated shell (layout.tsx renders AppNav)
    dashboard/               project cards: Spent / Budget / % bar
    projects/new             create project
    projects/[id]/           ProjectDetail — the seven tabs
    projects/[id]/edit
    projects/[id]/expenses/new
    projects/[id]/purchases/            invoices filed against this project
    projects/[id]/purchases/[pid]/edit  edit one invoice
    invoices/                top-level invoice entry point (chooser)
    invoices/upload          drag-drop / camera upload queue
    invoices/new             manual invoice entry
    invoices/[uploadId]/review  review-and-correct an extracted invoice
    suppliers/, suppliers/[id]   cross-project supplier list + statement
    items/, items/[id]           cross-project item list + price timeline
    settings/                trade lookups
  api/                       Route Handlers (all mutation goes through here)
  page.tsx                   login
  reset-password/
components/
  project/                   the seven tabs + InvoiceBanner + format.ts
  forms/                     ExpenseForm, PurchaseForm (1,658 lines), ProjectForm, LoginForm
  purchases/                 UploadInvoicePanel, PriceMoveBadge, PurchaseExpander,
                             SourceNote, SupplierFields
  charts/                    WeeklySpendChart, CategoryDonut
  ui/                        AppNav, Badge, Drawer, Toast, StatCard, States, ConfirmDialog
lib/
  data.ts          (804)  every server-side read: getProjectBundle, getSuppliers,
                          getSupplierBundle, getItems, getItemBundle,
                          getPurchaseFormBundle, getProjectPurchases, getPurchaseEditBundle
  calculations.ts   (54)  computeEntry — the per-row derived fields
  summary.ts       (270)  the legacy expense-entry aggregations
  invoiceViews.ts  (481)  the invoice-line aggregations (the current screens)
  purchases.ts     (393)  purchase/payment maths, price comparison, unit handling
  purchaseWrite.ts (372)  createPurchase / updatePurchase, supplier+item resolution
  validation.ts    (145)  shared client+server validation
  export.ts, pdf.tsx      Excel and PDF export
  api.ts, fetcher.ts, expense.ts   route-handler and client plumbing
  invoice/
    prompt.ts       (54)  system + task prompts for extraction
    extract.ts     (316)  Gemini call; text-layer vs vision path
    schema.ts       (88)  zod schema for the model's answer
    normalise.ts   (304)  dates, money, VAT rates, qty/unit splitting, category guess
    reconcile.ts   (203)  does the document add up? warnings, not blocks
    resolve.ts     (531)  match extracted supplier/items to existing rows
  supabase/        server.ts, client.ts, middleware.ts
types/index.ts     (766)  every shared type + the allowed-value constants
supabase/migrations/  0001–0012, applied by hand
scripts/           build_import_sql.py, verify_against_spreadsheet.py (legacy importer)
```

---

## 4. Architecture — data flows two different ways

This is the first thing to internalise, because getting it wrong produces code
that looks fine and does nothing.

**Reads — Server Components query Supabase directly.**
Pages under `app/(app)/` are async Server Components using `createClient()` from
`lib/supabase/server.ts`. `getProjectBundle(id)` in `lib/data.ts` fetches the
project, its expense entries, trade lookups, weeks, purchases, payments and
purchase lines in a small fixed number of queries and returns everything already
computed. The loaders never issue one query per row; a helper `selectIn()` skips
a round-trip when the id list is empty.

**Writes — Client Components call Route Handlers under `app/api/`.**
They go through `apiFetch` in `lib/fetcher.ts`. Every handler calls
`requireUser()` from `lib/api.ts`, which returns either `{ user, supabase }` or
`{ response }` — **the caller must check for `response` and return it early**;
that is the 401 path.

**All computation is shared and pure.** `lib/calculations.ts`,
`lib/summary.ts`, `lib/invoiceViews.ts` and `lib/purchases.ts` are plain
functions over plain data, imported by both the server pages and the client
components. Changing a formula there changes every screen at once, with no
migration and no backfill. That is intentional and is the core design bet of
the app (see §6).

**Auth.** `middleware.ts` runs `updateSession` on every non-static path to
refresh the Supabase session cookie. Route Handlers always use the *server*
client, never the browser client. `createServiceClient()` (service-role key)
exists only for storage MIME validation and signed URLs.

**Scoping is implicit: no query anywhere filters by `user_id`.** Every table has
exactly one RLS policy — `for all using (auth.uid() = user_id) with check
(auth.uid() = user_id)` — and that is the only thing separating tenants. Two
consequences worth stating in bold:

- **A new table without an RLS policy returns nothing** (or leaks everything, if
  RLS is left disabled).
- **An empty result is ambiguous**: "no rows" and "rows owned by a different
  user" look identical. This ambiguity caused a real data-loss incident (§12).

---

## 5. Data model

Twelve application tables in schema `public`, plus one view, plus a storage
bucket. Every table: `id uuid` PK, `user_id uuid references auth.users(id) on
delete cascade`, RLS enabled, one `auth.uid() = user_id` policy, `created_at` /
`updated_at` with an `updated_at` trigger.

### 5.1 The original four (migrations 0001–0003)

**`projects`** — `name`, `target_budget numeric(12,2)`, `status`
(`active|completed|paused`), `notes`. One row per job.

**`expense_entries`** — the original central table. One row per cost line of the
week-by-week plan.

| Column | Notes |
|---|---|
| `week_number` | integer > 0 |
| `description` | required; also the price-tracking key (lower-cased) |
| `category` | `Labour` \| `Materials` \| `Skip/Disposal` \| `Other` \| null |
| `trade` | free text; matched against `trade_lookups.name` **by convention only, no FK** |
| `location_room`, `notes`, `supplier`, `invoice_ref` | text |
| `paid_date` | a real `date` column |
| `payment_method` | `Cash` \| `Debit Card` \| `Credit Card` \| `Bank Transfer` \| null |
| `quoted_amount`, `actual_amount`, `paid_amount` | numeric(12,2) ≥ 0 |
| `qty`, `unit_cost` | materials detail; drives the legacy price tracker |
| `vat_rate` | **exactly 0, 5 or 20** (5 added by migration 0011) |
| `status` | `Planned` \| `In Progress` \| `Paid` \| `Cancelled` |
| `source` | `diary` \| `ledger`, default `diary` — see §7 |
| `receipt_url` | path in the private `receipts` bucket |

Indexes: `project_id`, `user_id`, `(project_id, week_number)`, `status`, and
`(project_id, lower(description))` for price lookups.

**`trade_lookups`** — default hourly rate + markup per trade, `unique (user_id,
name)`. Reference data; **nothing joins to it.** A trigger `trg_seed_trades`
fires `after insert on auth.users` and seeds 13 default trades (General Builder
45, Plumber 60, Electrician 65, …).

**`project_weeks`** — optional per-week `completion_pct`. The UI for it was
removed in 2026-08; the table, its API route and the computed field all still
exist and round-trip, but nothing displays them.

**Storage** — private bucket `receipts`, objects namespaced `{auth.uid()}/…`,
enforced by three `storage.objects` policies (read/write/delete).

### 5.2 The transaction core (migration 0008, run 2026-08-14)

Eight tables added *alongside* the four above, none of which was touched.

| Table | Scope | Holds |
|---|---|---|
| `suppliers` | **above the project** | one row per merchant: `name`, `type`, `account_ref`, `notes`, plus `vat_number`, `address`, `created_from_upload_id`, `is_unverified` (added by 0010) |
| `supplier_aliases` | above the project | every spelling that means that supplier |
| `items` | above the project | one row per material: `canonical_name`, `category`, `default_unit`, `pack_size`, `pack_unit` |
| `item_aliases` | above the project | every spelling that means that item |
| `purchases` | per project | one row per **document** |
| `purchase_lines` | per project | the items on that document, N per purchase |
| `payments` | per project | one row per time money changed hands |
| `receipts` | per project | attachments, hung off the document |

**Why they exist:** `expense_entries` flattens *document* and *item* into one
row, and *purchase* and *payment* into one row. That makes multi-line invoices
impossible, supplier grouping unreliable string matching, and "what did I owe
Lawsons on 14 August?" unanswerable.

**Four things about `purchases` that matter:**

- **`gross_total` is a Postgres GENERATED column** — `net_total + vat_total`,
  stored, not writable. Read it; never set it.
- **Balance and payment status are not columns.** `balance = gross_total − Σ
  payments.amount`; Paid/Partial/Pending derives from that, computed on read by
  `computePurchase` in `lib/purchases.ts`.
- **`origin` and `entry_source` answer different questions.** `origin` is where
  the data came from (`manual` / `excel` / `text` / `invoice_ocr` /
  `legacy_import`); `entry_source` is which half of the app it belongs to
  (`diary` / `ledger`). Never merge them.
- **`entry_status`** is the lifecycle flag copied from `expense_entries.status`
  (`Planned`/`In Progress`/`Paid`/`Cancelled`). It is **not** a payment state.
  It exists because every summary excludes cancelled rows.

`purchases.legacy_entry_id` points back at the `expense_entries` row it was
backfilled from — both an audit trail and what makes the migration re-runnable.

**`public.norm_key(text)`** — an IMMUTABLE SQL function: trim, lower-case,
collapse internal whitespace. Every uniqueness index on the new tables uses it,
and it is deliberately the same rule as `priceKey()` in `lib/summary.ts` and
`normaliseName()` in `lib/purchases.ts`. **All three must stay in step** or the
database, the price tracker and the alias matcher will disagree about what one
item is.

### 5.3 Invoice upload (migration 0010, extended by 0012)

**`invoice_uploads`** — one row per uploaded file on its way into `purchases`:
`project_id` (**nullable** since 0012), `storage_path`, `original_name`,
`mime_type`, `size_bytes`, `status`, `error`, `extraction_raw` (the model's
answer stored verbatim, for ever), `extraction_method` (`text`|`vision`),
`page_count`, `invoice_id` (the purchase it became).

Status lifecycle: `pending` → `processing` → `extracted` → `committed`, with
`failed` as the terminal error state. A CHECK enforces that a `committed` upload
must have a `project_id`.

0010 also added **pg_trgm** and two `match_*` RPC functions so the review screen
can ask "did you mean Lawsons?" without shipping every supplier name to the
browser, and `public.norm_vat(text)` — alphanumerics only, upper-cased,
deliberately *keeping* the country prefix, because two countries can issue the
same digits.

### 5.4 The one view

**`public.expenses_view`** (0008) — shaped exactly like `expense_entries` but
sourced from `purchases + purchase_lines + payments + suppliers + receipts`. It
exists so a later phase can point old screens at the new tables without
rewriting them, and switch back if it goes wrong. **Nothing reads it today.**

Created `with (security_invoker = true)`, and that is **not optional**: a plain
Postgres view runs with its owner's rights and would hand every user everyone
else's rows, because RLS on the base tables is the only scoping in this app.
Requires Postgres 15+.

Two honest differences from the table: `id` is the *purchase* id (with
`legacy_entry_id` exposed alongside), and a purchase with more than one line
collapses to a single row with `qty`/`unit_cost` reported as `0`, because there
is no single answer. Every backfilled purchase has exactly one line, so the view
is exact for legacy data and stops being exact the moment a real multi-line
invoice exists.

---

## 6. The invariants — rules that make the numbers true

These are the load-bearing rules. Each one exists because breaking it produced a
wrong number on a screen at least once.

### R1. Totals are computed, never stored

`total_incl_vat` does not exist as a column. `computeEntry` in
`lib/calculations.ts` derives `subtotal`, `vat_amount`, `total_incl_vat`,
`materials_cost` and `remaining` on every read, turning `ExpenseEntry` into
`ExpenseEntryComputed`. Same for purchases: `paid`, `balance` and `status` are
derived by `computePurchase`. The one exception, `purchases.gross_total`, is a
Postgres GENERATED column — i.e. still not independently writable.

**Corollary: `actual_amount` is ex-VAT.** Writing an incl-VAT figure into it
applies VAT twice. That is exactly what migration 0005 did, and the Overview
read £43,686.17 where the spreadsheet said £42,411.81.

### R2. `source` / `entry_source` splits the app in two, and the halves are never summed

`expense_entries.source` and `purchases.entry_source` are both `diary` |
`ledger`. They are two *overlapping records of the same job*, so a query that
sums both is double-counting. Every screen that reports project spend filters or
splits on it. See §7 for the full story.

### R3. Never add `.eq("user_id", …)` to a query

RLS does the scoping. Adding the filter is not "belt and braces" — it hides the
case where RLS is misconfigured, which is the failure you most want to see.

### R4. CHECK constraints reject, they do not coerce

`vat_rate = 17.5` fails the insert outright. The allowed value lists in the
database and the constants in `types/index.ts` (`EXPENSE_CATEGORIES`,
`EXPENSE_STATUSES`, `PAYMENT_METHODS`, `PROJECT_STATUSES`, `VAT_RATES`) must be
changed together.

### R5. Every `user_id` is `on delete cascade` to `auth.users`

Deleting an auth user silently destroys all of that user's projects, expenses,
weeks and trade lookups. **This has already happened once** (§12). The cascade is
still in place; the same deletion would cause the same loss again.

### R6. A percentage is never computed across two different units

`comparePrice` in `lib/purchases.ts` returns a percentage only when both
purchases are per the same unit. Otherwise it returns `move: 'unit_change'` with
a **null** delta, and `PriceMoveBadge` renders "bag → tonne — check pack size"
rather than a number. £12 a bag against £12 a tonne is not a 0% change, and *a
price alert that lies once gets ignored for ever.*

### R7. The header may not disagree with the lines it is made of

An invoice's net, VAT and gross are the sum of its lines, computed on save,
never typed. VAT is rounded **per line and then added**
(`purchaseTotalsFromLines`), and every downstream view repeats that same order,
so a line total and the header it came from agree to the penny.

### R8. £0 per unit is not a price

Lines with no unit price stay in an item's timeline but carry no delta and do
not advance the comparison chain. Letting a zero in would invent a −100% drop
followed by an infinite rise.

---

## 7. `source` / `entry_source` — the biggest trap, in full

| | `diary` | `ledger` |
|---|---|---|
| Came from | the week-by-week spreadsheet, plus anything added in-app | a second workbook, `Renovation_Cost_Tracker-1.xlsx` |
| Rows today | the ledger side is **empty** since migration 0009 (2026-08-14) | **0** |
| Appears in | Expenses tab, all Overview analytics, Dashboard cards | nothing |

**Why the ledger is empty.** Until 2026-08-14 a second workbook was imported as
96 `ledger` rows and its total (£98,932.12) became the project's
`target_budget`. It turned out to be **a different building job**. Four
independent facts said so:

- The updated workbook states the address on both sheets; the second names no
  address anywhere.
- Date ranges do not overlap by a single day: the second runs 2025-11-02 →
  2026-01-25 and stops a month *before* this project's week 1.
- The second is 100% paid (£98,932 of £98,932); this project was £13,273 of
  £151,645.
- The second *ends* with carpets, staging and a driveway clean — a house being
  dressed for sale — while this one *begins* by stripping back to brick.

The shared supplier names (Lawsons, Alspec, Eurocell, Wunda, Johnstones) are the
same trades used again on the next job, which is exactly what let it contaminate
a string-matched price tracker.

**It also broke the price tracker outright.** That workbook's "Materials &
Suppliers" sheet was a *payment log*, not a price list: `Item` empty on all 60
rows, `Quantity` = 1 on all 60, and `Unit Cost (£)` holding *the amount of that
payment*. Instalments therefore read as unit prices — Wunda UFH "rose 761.9%"
between a deposit and its balance; plumbing "rose 100%" across seven progress
payments. Eleven suppliers did this, and since the diary recorded no unit costs
at all, **100% of the price tracker's content was instalment payments misread as
prices.**

**The mechanism stays even though one side is empty.** The column, the CHECK
constraint and every filter are deliberately still in place: they are correct,
cheap, and the only thing standing between the app and a double-count the day a
second dataset arrives. Do not delete them as dead code.

**Never use `week_number` to tell diary from ledger.** Ledger rows carried
`week_number = 1` because that workbook had no week column; an early migration
backfilled "weeks 16+" as ledger and a later one re-imported them all at week 1.
Use `source`.

---

## 8. Calculation reference

### 8.1 Per row — `lib/calculations.ts`

| Field | Formula |
|---|---|
| `subtotal` | `actual_amount` |
| `vat_amount` | `actual_amount × vat_rate / 100` |
| `total_incl_vat` | `actual_amount + vat_amount` |
| `materials_cost` | `qty × unit_cost`, **only if both > 0**, else 0. Informational only — never used in a total |
| `remaining` | `total_incl_vat − paid_amount` |

`remaining` uses the incl-VAT basis because `paid_amount` records the incl-VAT
sum actually handed over; an ex-VAT basis made every fully-paid VAT-bearing row
look overpaid.

`formatCurrency` — `en-GB`, GBP, always 2 decimals.

### 8.2 Overview cards — `buildSummary`, `lib/summary.ts`

Input: diary entries only, further filtered by `ACTIVE = status !== "Cancelled"`.

| Card | Formula |
|---|---|
| Target Budget | `projects.target_budget` — stored, not computed |
| Total Quoted | `Σ quoted_amount` |
| Actual Total | `Σ total_incl_vat` |
| Variance vs Quote | `Actual − Quoted`, rounded to the penny and normalised so an exact match renders `0`, not `-0` |
| Paid to Date | `Σ paid_amount` |
| Remaining to Pay | `Actual − Paid` |
| Weeks Tracked | count of **distinct** `week_number` |

Header "% of budget" = `round(forecast_total / target_budget × 100)`. **Zero
budget is handled everywhere** — the card, the header, the dashboard bar and the
project list all check `> 0` and hide rather than divide, so nothing ever renders
`Infinity` or `NaN`.

### 8.3 Weekly chart and category donut — `buildByWeek`, `buildByCategory`

One row per `week_number`, ascending, cancelled excluded. `materials` = Σ
incl-VAT where category is Materials; `labour` = Σ incl-VAT for **every other
category**, including Skip/Disposal and Other — it is "not-materials", not
literally labour. The donut has exactly those two slices.

Note the split rule was inverted on 2026-08-20 to "Labour, or else materials",
so that uncategorised invoices (the extractor sets no category) stop landing in
the Labour half.

### 8.4 The five invoice-driven screens — `lib/invoiceViews.ts`

Everything starts from `buildInvoiceLines`, which flattens this project's
`purchase_lines` and carries down what the parent `purchases` row knows
(supplier, date, week, trade, category, status). Cancelled purchases are
dropped, as is any line whose purchase is missing.

Per line: `vat_amount = round2(line_net × vat_rate / 100)`,
`line_gross = line_net + vat_amount` (R7).

- **Trades** (`buildTradeRows`) — grouped by `purchases.trade`, null →
  `"Unassigned"`, sorted by gross descending. Columns: invoice/line counts,
  quoted (Σ `quoted_gross`), net, VAT, gross, paid (Σ payments), balance,
  status.
- **Labour** (`labourLines`) — one row per line whose invoice's `category ===
  "Labour"`. **Only an explicit Labour counts**: guessing that an uncategorised
  line is labour would move real money between two screens on no evidence, and
  Labour is the figure that gets quoted at people.
- **Materials** (`materialLines`) — one row per line whose category is **not**
  Labour: Materials, Skip/Disposal, Other **and uncategorised**. The asymmetry
  against Labour is deliberate — requiring `category === "Materials"` hid every
  uploaded invoice, because the extractor sets no category.
- **Suppliers** (`buildSupplierRows`) — the same invoices grouped by
  `supplier_id`, with one shared `"No supplier"` bucket. Project-scoped; the
  `/suppliers` nav item is the cross-project view and is a different question.
- **Price Tracker** (`buildItemPriceRows`) — any line with `unit_price > 0` on a
  non-cancelled purchase. Grouped by `items.id` when matched, else the
  normalised description. Ordered by `purchase_date` with `invoice_no` breaking
  ties. Sorted with the biggest recent rise first; a null delta (first buy, or a
  unit change) sorts last.

> **Why Trades and Suppliers roll up whole invoices while Labour and Materials
> list lines.** Payment is recorded against a *document*. Splitting one payment
> across that document's lines would invent a figure the payment record never
> stated. So the two rollup screens show a paid column and the two line screens
> show none.

### 8.5 Legacy aggregations still in `lib/summary.ts`

`buildTrades`, `buildMaterials`, `buildMaterialLedger`, `buildPriceHistory`,
`buildPriceAlerts` all still exist and still work. **No screen calls them any
more** — only the API routes `/api/projects/[id]/{trades,materials,prices}` and
the Excel/PDF exports do. `buildPriceHistory` in particular still lacks the unit
check and the null delta of R6; it is what reported the 761.9% rise.

---

## 9. Screens

### Navigation

`components/ui/AppNav.tsx` renders two components, each hidden at the other's
breakpoint (`sm` = 640px): a desktop horizontal `TopNav` and a mobile sticky bar
with a hamburger opening a **left-hand slide-in drawer** (closes on route
change, on Escape, and on overlay click; locks body scroll while open).

Nav items: **Dashboard · Invoices · Suppliers · Items · Add Project · Settings**.
Note `/projects` matches project *detail* pages but deliberately excludes
`/projects/new`, which is its own item.

**Responsive pattern for tables — important.** Every data table renders twice
from the same array: a `sm:hidden` card list and a `hidden sm:block` table.
**If you add a column, add it to both**, or it is invisible on a phone.

### The seven project tabs — `components/project/`

| Tab | Reads |
|---|---|
| Overview | expense entries, non-ledger only |
| Expenses | expense entries **plus** the project's invoices as synthetic rows |
| Trades | invoices (`purchases`) |
| Labour | invoice lines, category = Labour |
| Materials | invoice lines, category ≠ Labour |
| Suppliers | invoices grouped by supplier |
| Price Tracker | invoice lines with a unit price |

`ProjectDetail.tsx` is the client shell: it holds entries in state and computes
every summary with `useMemo`, **from two different sources**. That is the thing
to know before changing any of them.

The **Expenses tab** shows both hand-entered `expense_entries` and the project's
invoices, the latter as synthetic entries with an `inv:<uuid>` id
(`purchasesToSyntheticEntries`). Invoice rows carry an "Invoice" badge and their
**Edit** opens the invoice form rather than the expense drawer — an invoice's
supplier, lines and VAT belong to the document, and only that form can change
them without leaving the header disagreeing with its lines (R7). **Mark Paid**
on an invoice writes a `payments` row for the *difference* between what you say
is paid and what the payment rows already total, so pressing it twice cannot pay
it twice.

### Cross-project supplier and item screens

`/suppliers`, `/suppliers/[id]`, `/items`, `/items/[id]` are **read-only** — no
form, no API route, no mutation — async Server Components with `dynamic =
"force-dynamic"`, shipping **no client JavaScript** (expand/collapse is a plain
`<details>` element). They are **cross-project by design**, because a supplier
and an item sit above the project, which is why none of them shows a "project
total".

Every total on them is **split by `entry_source` and labelled** — separate
columns, separate card groups, separate tables, separate running totals. The
supplier list is even *sorted on record count rather than money* for the same
reason.

### API surface — `app/api/`

All handlers call `requireUser()` first.

| Route | Methods | Purpose |
|---|---|---|
| `/api/projects` | GET, POST | list / create |
| `/api/projects/[id]` | GET, PATCH, DELETE | one project |
| `/api/projects/[id]/expenses` | GET, POST | list (**entries + invoices merged**) / add |
| `/api/projects/[id]/expenses/[eid]` | PATCH, DELETE | one entry; an `inv:` id routes to `patchInvoice` |
| `/api/projects/[id]/purchases`, `/[pid]` | CRUD | invoices |
| `/api/projects/[id]/summary`, `/by-week`, `/by-category` | GET | ⚠️ unfiltered — see §13 |
| `/api/projects/[id]/trades`, `/materials`, `/prices` | GET | legacy `lib/summary.ts` builders |
| `/api/projects/[id]/weeks` | POST/PUT | `completion_pct` — no longer called by any screen |
| `/api/projects/[id]/export/excel`, `/export/pdf` | GET | ⚠️ unfiltered |
| `/api/expenses/[eid]/receipt` | POST | upload to the `receipts` bucket |
| `/api/invoices/upload-url` | POST | signed upload URL + new `invoice_uploads` row |
| `/api/invoices/[id]` | GET | the upload row + a 5-min signed read URL |
| `/api/invoices/[id]/extract` | POST | download → extract → resolve; always ends on a terminal status |
| `/api/invoices/[id]/commit` | POST | writes the reviewed invoice via `createPurchase` |
| `/api/lookups/trades`, `/[id]` | CRUD | trade lookups |
| `/api/auth/signout` | POST | sign out |

---

## 10. The invoice ingestion pipeline

This is the app's most substantial feature and the part most worth carrying into
a new project. Five stages.

### Stage 1 — upload (`components/purchases/UploadInvoicePanel.tsx`)

`POST /api/invoices/upload-url` → `PUT` **straight to the returned signed URL**
→ `POST /api/invoices/[id]/extract`.

**The file never passes through a Next.js route.** That is deliberate: Next
route handlers cap request bodies at 4.5MB and a phone photo of an invoice
routinely exceeds it. The `PUT` is a hand-rolled `XMLHttpRequest` rather than
the Supabase SDK's `uploadToSignedUrl`, because the SDK's version reports no
upload progress and a 12MB photo is not instant.

Several files can be queued at once, each with its own row and status, so one
failure never blocks the others. A project-less file is stored under
`{user.id}/unassigned/…`; **the file is never moved once a project is chosen** —
the row records where an invoice belongs, not the path.

Once extraction starts, a **Supabase Realtime** subscription on that
`invoice_uploads` row is the primary way the UI learns the outcome; a poll runs
alongside it from the start and only *backs off* (never stops) once Realtime
confirms it connected — so a dropped Realtime connection still resolves, just
more slowly. A `failed` row shows the stored error with **Retry** (re-POSTs
`/extract` on the same row if the file reached storage, else resumes from the
top) and **Enter manually instead**.

### Stage 2 — extraction (`lib/invoice/extract.ts`)

Two paths, chosen by whether the document can be read as text:

- **text** — the PDF carries a real text layer (generated by the merchant's
  accounting system). `unpdf` extracts it and the text is sent. Cheaper, faster,
  exact: no OCR step means no OCR errors.
- **vision** — everything else: photographs, scans, and PDFs whose "text" is an
  image. The file itself is sent.

Detection is **deliberately conservative**: a text layer shorter than 240
characters is treated as none, because scanned documents routinely carry a
handful of characters from a stamp or a fax header, and reading only those would
be worse than looking at the page. Cap of 20 pages on the vision path.

The call uses Gemini structured output (`responseJsonSchema`, real JSON Schema
with `anyOf[type,"null"]`, not the older OpenAPI `nullable` flag), a 16,000
token cap, and `thinkingBudget: -1` (automatic), because attention needed varies
enormously between a two-line receipt and a forty-line account statement.

**Failure handling that earned its place:** a refusal or content-safety stop
arrives as a *normal* response with a non-`STOP` `finishReason`, so that is
checked *before* `.text` is read. `MAX_TOKENS` gets its own message ("split it
and upload the pages separately"). Everything that should surface as a failed
upload throws `ExtractionError`.

**Three fields carry their rule on the JSON-Schema property itself**, not only
in the system prompt — quantity, unit and VAT rate — because a schema
description is read at the moment the field is written. These are the three that
had been repeatedly got wrong.

### Stage 3 — normalisation (`lib/invoice/normalise.ts`)

Dates, money, payment methods, VAT rates, and a category guess. Two fixes here
are worth transferring wholesale, because both were **silent** — a wrong or
empty field on a screen whose entire job is being trusted at a glance:

- **`splitQtyFromUnit()`** — merchant invoices print quantity as `10.000EA` /
  `5EA` / `2BAG`, and once a PDF's layout is gone that arrives as one token. The
  prompt asks for them split, **but asking is not a guarantee** (a prompt-only
  fix earlier the same day did not hold), so this does it deterministically. A
  quantity is only taken from the unit when none was read. As a last resort a
  missing qty is derived from `line_net / unit_price`, but **only when that comes
  out whole** and multiplies back to the printed total to the penny — a
  fractional result means a discount or part-load and is left blank.
- **The VAT rate when it isn't 0 or 20.** `normaliseVatRate` used to drop
  anything else to null and the form defaulted to `"0"`, so a **5% invoice —
  ordinary on residential renovation work — saved as zero-rated and its VAT
  vanished from every total.** Migration 0011 widened the CHECK to 0/5/20. A rate
  still outside the set leaves the box **empty, not zero**, `documentNotes()`
  names the rate that could not be stored, and `validatePurchase` refuses to save
  until a human picks one.

### Stage 4 — reconciliation and resolution

**`lib/invoice/reconcile.ts`** — does the document add up? Line sum vs printed
net, net + VAT vs gross, with a 2p tolerance. Produces **warnings, never
blocks**, rendered *at the field they are about* and recomputed live as lines are
edited — not a banner.

**`lib/invoice/resolve.ts`** — matches the extracted supplier and each line's
item against existing rows, in tiers: `vat` (the VAT number, the only hard
identifier an invoice carries), `exact` (normalised name), `fuzzy` (pg_trgm
similarity, thresholds 0.34 to suggest / 0.62 for "likely"), `none`. Returns a
confidence band: `certain` / `likely` / `possible` / `none`. A supplier the
system invents on its own is flagged `is_unverified` and carries
`created_from_upload_id`, so the screens can say "unverified" rather than
pretending the name came from somewhere authoritative.

### Stage 5 — review and commit (`app/(app)/invoices/[uploadId]/review`)

A Server Component. It re-validates `extraction_raw` with `parseExtraction`,
**re-resolves the supplier and every line against the *current* tables** (not the
snapshot the extract route saw — a supplier added since then still matches),
builds a prefill, and renders the signed-URL original next to `PurchaseForm`.

- The panes are **2fr / 3fr**, not half and half: *the document is the reference,
  the form is the work.* The preview is capped at 60% of screen height (45% on a
  phone) with an "Open full size ↗" link.
- **There is exactly one purchase form component in the codebase.**
  `invoices/new`, `purchases/[pid]/edit` and this review page all render the same
  `PurchaseForm`, which gained six *optional* props so neither of the other two
  paths' behaviour changed.
- The supplier field **branches on the confidence band**: `certain` →
  preselected and collapsed with a "Change" link; `likely`/`possible` → a
  candidate list with match scores plus "None of these — add new supplier";
  `none` → the new-supplier fields shown already expanded and prefilled. **Every
  branch also offers a search fallback**, so a weak or absent match is never a
  dead end.
- The **duplicate-invoice check** is the form's pre-existing memo against every
  invoice number already used, which fires the moment the prefilled form mounts.
- Save posts to `/api/invoices/[id]/commit` and lands on the created purchase's
  edit page rather than a list.

**Known limitation:** the review page's signed read URL is valid for 10 minutes;
a review left open longer needs a reload.

---

## 11. Validation

Runs **both client-side and server-side from the same file**, `lib/validation.ts`.

- `validateProject` — name required ≤200 chars; `target_budget ≥ 0`; status in
  set.
- `validateExpense` — positive integer week; description required ≤200; category
  in set; all five amounts ≥ 0; `vat_rate` one of 0/5/20; status and payment
  method in their sets.
- `validatePurchase` — the header plus every line and payment. On a line, **a
  blank `vat_rate` is its own error** ("Pick the VAT rate printed on the
  invoice"), separate from an out-of-set one — because a blank that silently
  saved as 0% is precisely the bug described in §10 stage 3.
- `lib/expense.ts` → `buildExpensePayload()` normalises a form body into a DB
  payload: coerces the numeric fields, maps `""` → `null`, defaults status.

These mirror the DB CHECK constraints. **Change a constraint, change both.**

### Non-blocking advisories in the expense form

Separate from validation, `ExpenseForm.tsx` computes five advisories that
**never block saving**, all pure `useMemo` over `priorEntries` with no DB
round-trip. They exist to catch mistakes at entry time rather than in a report
weeks later:

| Warning | Fires when |
|---|---|
| `lastPriceHint` | Materials, description matches a past purchase, no unit cost typed yet |
| `priceWarning` | as above, plus a unit cost entered — shows ±% vs last purchase |
| `duplicateWarning` | same normalised description **and** week **and** actual within £0.005 of an existing non-cancelled entry |
| `overpaidWarning` | `paid_amount − actual_amount > 0.005` |
| `unitMismatch` | Materials, qty and unit cost both > 0, and `\|qty × unit_cost − actual\| > 0.01` — with a one-click fix |

**`priorEntries` must be passed in or all of them silently do nothing** (it
defaults to `[]`).

Entry shortcuts worth keeping: description and supplier are `<datalist>`
type-aheads built from prior entries, de-duplicated case-insensitively — beyond
saving typing, **this keeps spellings consistent, because divergent spellings
split one item into two in the price tracker**. A **Repeat** row action copies
everything except the payment fields and resets the week, so repeating a
purchase leaves only the price to change — and changing it immediately trips
`priceWarning`. Optional fields sit behind a collapsed toggle that auto-opens
when editing an entry that already uses any of them.

---

## 12. History — what went wrong, and what each incident taught

Reproduced because these are the transferable lessons, not repo trivia.

**2026-07-20 — everything disappeared.** An auth user was deleted; every
`user_id` FK is `on delete cascade`, so all projects, expenses, weeks and trade
lookups went with it. The investigation was misdirected for a long time because
RLS makes "no rows" and "rows owned by someone else" indistinguishable, and
because `trg_seed_trades` gives a fresh account 13 trade lookups immediately —
so "some data exists" was a decoy. *Diagnostic order that works:* query counts in
the SQL editor (bypasses RLS) → if all zero the rows are gone → check `select
id, email from auth.users`, because a recreated account gets a **new UUID** and
same email does not mean same user.

**2026-07-22 — the dashboard said 144%, the project page said 44%.** The
dashboard card was missing the `source !== 'ledger'` filter and was summing both
halves. Lesson: a split like that must be applied at *every* consumer, and the
list of consumers must be written down (it now is).

**2026-08-06 — the double-VAT bug.** The import stored the spreadsheet's *Total
incl. VAT* column into `actual_amount` *and* set `vat_rate = 20`, so VAT was
applied twice on read. Lesson: when a derived field exists, the column feeding it
needs its VAT basis stated in the schema comment, the type, and the importer.

**2026-08-14 — the second workbook was a different job.** See §7. Lesson: shared
supplier names are not evidence of a shared project, and a string-matched key
will happily merge two datasets that have nothing to do with each other.

**2026-08-17 — the suppliers page showed notes instead of suppliers.** The
spreadsheet's `Supplier` column had 8 non-empty cells in 111 rows, and seven of
them were sentences typed into the wrong column ("£300 PAID FROM OWED", "steels
in"). The real merchant names had been typed into `Task / Description` on the
Materials rows all along — 32 distinct merchants. The importer now reads them
from there against an **owner-confirmed declared list**, guarded by
`check_suppliers()`, which **aborts the import** if the distinct Materials
descriptions and the list stop matching in either direction. *Nothing anywhere
guesses which strings "look like" a merchant* — that is the property that keeps
the import verifiable against its source.

**2026-08-18 — quantity and VAT rate lost in extraction.** See §10 stage 3. Two
lessons: (a) *asking a model in the prompt is not a guarantee* — where a value
must be right, normalise it deterministically afterwards; (b) an empty field is
safer than a defaulted one when the default is a legal value that changes a
total.

**2026-08-20 — the analysis screens read an empty table.** The owner removed the
spreadsheet import; five screens still read `expense_entries` and showed
nothing, while the invoice data sat in `purchase_lines`. Three related bugs
surfaced at once: the Expenses list emptied itself on refetch (the GET endpoint
returned only the table, not the merged invoices), Mark Paid on an invoice
silently did nothing (a purchase has no paid column), and the price tracker was
empty. Lesson: when the source of truth moves, every reader moves with it in the
same change, and a refetch endpoint must return exactly what first load
returned.

---

## 13. Known issues, open risks, current state

**Open, deliberately unchanged**

- **The `on delete cascade` FKs remain.** The same deletion would cause the same
  total loss again.
- **The summary/export API routes pass unfiltered entries into `buildSummary`.**
  `/api/projects/[id]/summary`, `/by-week`, `/by-category`, `/export/excel` and
  `/export/pdf` do not apply the diary/ledger filter and therefore return the
  double-counted figure. With the ledger empty this makes no difference to any
  number today, so exports are correct *by accident*. **It bites again the moment
  a `ledger` row exists.**
- **`buildPriceHistory`** (still behind `/api/projects/[id]/prices` and the Excel
  export) has neither the unit check nor the null delta of R6 — it is what
  reported the 761.9% rise.
- **`purchase_date` is really the paid date for all legacy data.** The
  spreadsheet had no purchase-date column, so the backfill used the hand-typed
  paid date, null on the 91 rows never paid. `purchaseOrderKey` falls back to
  `created_at`. A timeline ordered by `purchase_date` is ordering by *payment*
  for legacy rows.
- **Seeded `items` are sometimes merchants.** Migration 0008 seeded `items` from
  distinct `description`, and on Materials rows the description *is* the merchant
  name — so `/items` can list `Lawsons` and `Topps Tiles` as though they were
  materials. The sheet had no item column to read instead, so there was nothing
  honest to import. Real item names arrive from invoices.
- **Review-screen signed URL expires after 10 minutes.**

**Migration run status (verify before relying on it)** — `about.md` §12 records
`0009`, `0011` and `0012` as *written but not yet run*, while later `updates.md`
entries describe behaviour that requires them (5% VAT storage; project-less
uploads). **Check the actual database before planning on top of this.** If
`0012` has not been run, every upload from the new screen fails with a not-null
violation on `project_id`, because the app now sends null.

**Data state.** The spreadsheet import has been removed by the owner;
`expense_entries` is empty or nearly so, and the project is being rebuilt from
invoices one at a time. The figures recorded in `about.md` §13 (Total Quoted
£151,644.78, Paid to Date £13,273.40, 111 diary rows, 23 weeks) are the record of
what the retired dataset contained — **they are no longer a regression
baseline**, and there is nothing to regress against until enough invoices are in
to make one.

**Verification gaps.** There is no test suite; `npm run build` is the only full
typecheck and the de-facto test. The legacy importer had a genuine regression
harness — `scripts/verify_against_spreadsheet.py` replays `computeEntry`,
`buildSummary`, `buildByWeek` and `buildByCategory` in Python against the source
spreadsheet and exits non-zero on any disagreement — but it only covers the
retired import path. The invoice-driven builders were exercised against
hand-constructed rows, not through the UI: the last two changes were shipped
**without being clicked through**, because the browser used for checking had no
login session.

---

## 14. Working conventions (repo rules)

These are enforced by `CLAUDE.md` and are unusually strict for a project this
size. They are the reason the history above is recoverable at all.

1. **Every change gets an entry in `updates.md`** — schema, code, data, docs,
   however small. In plain English, written so a non-developer can follow it a
   year later. It must state: what changed and why; where the information came
   from (which spreadsheet + sheet, table, or screen); **files used (read)** and
   **files changed**, by path; whether a migration was written *and whether it
   has actually been run*; and any headline figure that moved, as `before →
   after`.
2. **If `about.md` becomes wrong because of a change, update `about.md` too**,
   including its current-figures section.
3. **Migrations are run by hand** in the Supabase SQL editor. Writing the file is
   not applying it, and the change note must say which it is.
4. **If SQL is generated, edit the generator, never the `.sql`.**
5. **Run `npm run build`** (full typecheck) after anything non-trivial.
6. Before changing anything: does this touch a diary/ledger boundary (§7)? Am I
   about to store a computed total (R1)? Does this need a migration?

**Current working tree is dirty.** The 2026-08-20 work — `lib/invoiceViews.ts`,
`LabourTab`, `SuppliersTab`, `InvoiceBanner`, the `/invoices` route move, and
migration `0012` — is **modified/untracked, not committed**. Last commit is
`9970b90 added gemini flash to extract text from invoice`.

---

## 15. What to carry into a new project

Design decisions here that earned their keep, and would be worth repeating:

- **Derive on read; store only what a document actually stated.** Totals,
  balances, statuses and percentages are all computed by pure functions over
  plain rows. Changing a formula changes every screen at once, with no migration
  and no backfill. The one stored derived value is a Postgres GENERATED column,
  which cannot drift.
- **Model the document, not the row.** One purchase = one document, N lines, N
  payments. The flat "one row is a cost" model cannot express a multi-line
  invoice, cannot group suppliers reliably, and cannot answer "what did I owe
  them on this date".
- **Keep the raw extraction for ever, and validate it at the boundary.**
  `extraction_raw` is stored verbatim and typed as `unknown`; it is evidence,
  not a contract, and every read goes through a zod schema first.
- **Never write LLM output straight into the domain tables.** A human reviews
  every invoice, with the original document beside the form, before anything is
  committed.
- **Normalise deterministically after the model, not only in the prompt.**
  Prompt-only fixes for the quantity field did not hold; a small deterministic
  function did.
- **Show nothing rather than a lie.** No percentage across a unit change; an
  empty VAT box rather than a defaulted 0%; "no price history yet" rather than a
  fabricated zero. A number that is wrong once is distrusted for ever.
- **Declared lists over heuristics, with a guard that aborts.** The importer
  refuses to run when its supplier list and the source data disagree, instead of
  silently importing a blank.
- **Warnings at the field, computed live** — reconciliation mismatches, price
  changes, duplicates — rather than a banner or a post-hoc report.
- **One normalisation rule, defined once and mirrored deliberately** (`norm_key`
  in SQL = `priceKey` = `normaliseName` in TS). Write down that they must stay in
  step, because nothing enforces it.
- **A prose reference document maintained alongside the code.** `about.md` and
  `updates.md` are why a bug from three months ago can still be explained, and
  why a rule that looks like dead code can be recognised as load-bearing.

Things to do differently:

- **Add a test suite.** Every incident in §12 would have been caught by a handful
  of unit tests over the pure builder functions, which are trivially testable —
  they are already pure functions over plain data.
- **Do not put `on delete cascade` on the tenant FK** without a soft-delete or a
  backup path in front of it.
- **Apply migrations with a tool**, so "written" and "run" cannot diverge.
- **Retire dual code paths deliberately.** `lib/summary.ts` and
  `lib/invoiceViews.ts` now compute overlapping answers from different tables,
  and the API routes and exports still use the older, weaker one. Two answers to
  one question is a bug waiting for a consumer.
