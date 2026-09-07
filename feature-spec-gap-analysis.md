# Feature spec gap analysis — RenovaTrack vs *Renovation Tracking Software: Feature Spec*

**Written:** 2026-09-03
**Source of the requirements:** `renovation-tracker-spec.pdf` (3 pages, supplied by the
owner). Its full contents are transcribed in §2 below so this document stands
on its own if the PDF is lost.
**Source of the "current situation":** the code in this repository as of commit
`6994484`, plus `about.md` and `updates.md`.

**Nothing was changed to produce this document.** No code, schema, data or
migration was touched. This is a read-only assessment written so the owner can
decide what to build next, and in what order.

---

## 1. The one-paragraph summary

RenovaTrack today is a very good **money** tracker and a poor **schedule**
tracker. It knows, per invoice line, what was bought, from whom, at what unit
price, how much VAT, how much has been handed over and how much is still owed —
and it can ingest an invoice from a photo or from an email inbox automatically.
What it has **no concept of at all** is *time*: there are no tasks, no dates
other than a purchase/paid date, no phases, no dependencies, no baseline, and
therefore nothing that could drive a Gantt chart or a critical path. It also has
no documents store beyond invoice scans, no people records (a subcontractor is a
free-text name on a line), no snagging list, and no photo timeline.

Roughly: **the spec's §3 "Money" is largely done, §1 is half done, and §2, §4,
§5, §6 and §7 are essentially greenfield.** The spec's own Priority Note asks
for two things — real-time actual-vs-budget per trade line, and cost tied to
schedule changes. The first of those already exists and is arguably the app's
strongest feature. The second cannot exist until a schedule does.

---

## 2. What the PDF asks for (verbatim structure)

### 1. Core Project Tracking
- Project/phase breakdown (demo, first fix, second fix, snagging) with target vs actual dates
- Budget vs actual spend per trade/line item
- Change orders / variations log — what changed, why, cost impact
- Photo timeline tied to each phase, dated and location-tagged

### 2. People & Trades
- Subcontractor directory: contact info, insurance/cert expiry, day rates
- Task assignment per trade with due dates
- Sign-off/approval flow when a trade completes a stage

### 3. Money
- Purchase orders / trade account invoices logged against the project
- Running cashflow view: committed vs spent vs remaining budget
- Retention tracking (% held back from contractors)

### 4. Documents
- Planning permission / building control docs, warranties, certificates (Gas Safe, electrical) centralized
- Drawings/spec version control — always clear which version is current

### 5. Communication
- Activity log / notes per project (calls, site visits, decisions made)
- Snagging list with photo + status (open / fixed / verified)

### 6. Reporting
- Dashboard: % complete, days behind/ahead, budget variance — **across all live projects at once**

### 7. Gantt Chart (core feature, not a bolt-on)

**Dependencies**
- Proper task linking (finish-to-start, start-to-start for overlapping trades)
  — e.g. electrician first fix can't start until stud walls are up; plasterer
  can't start until first fix is signed off
- When a task slips, dependent downstream tasks auto-shift (the "knock-on effect")

**Critical path**
- Highlight which tasks actually drive the completion date vs tasks with slack
- Flag when a delay eats into float vs when it pushes the final completion date
- Critical path recalculates dynamically as tasks change

**Change tracking**
- Baseline vs current view: original planned dates alongside actual/current dates, to visualise drift
- Version/revision log per task — reason for slip attached as a note (material delay, weather, client change, trade no-show)

**Cost tied to schedule**
- Each task/bar carries a budget and an actual cost
- When a task shifts or extends, automatically surface the cost implication
  (e.g. extended scaffold hire, extra day rate for a waiting trade)
- Cost impact appears **inline** when a task is dragged/edited — not in a separate spreadsheet

**Practical extras**
- Multi-project / portfolio Gantt — rolled-up schedule across all live sites
- Weather / lead-time flags for external trades (roofing, groundworks)
- "What if" drag-and-drop simulation — test a delay before committing it to the live schedule

**Priority note (quoted intent):** the most common failure point in renovation
tracking is budget drift going unnoticed until too late. Real-time
actual-vs-budget per trade line, and cost-impact tied directly to schedule
changes in the Gantt, are **must-have, not nice-to-have**.

---

## 3. Where the project stands today

### 3.1 What it is

RenovaTrack — a renovation cost tracker for **46 Glenferrie Road, St Albans**.
Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth +
Storage). Deployed on Vercel. Charts by Recharts; PDF export by
`@react-pdf/renderer`; Excel export by `xlsx`; invoice extraction by
`@google/genai` with `unpdf` for text extraction.

**One shared workspace, not a multi-tenant product.** Since migration `0015`
every RLS policy is `for all to authenticated using (true) with check (true)`.
Signing in *is* the whole authorisation model — anyone with a login sees and can
edit everything. Sign-up is disabled; users are created by hand in the Supabase
dashboard. `user_id` still exists on every row but is provenance, not
permission.

**Migrations are applied by hand** — each file in `supabase/migrations/` is
pasted into the Supabase SQL editor and run in filename order. There is no
migration CLI and no test suite; `npm run build` is the only full typecheck.

### 3.2 The data model as it exists

**Original four tables** (`0001`–`0003`):

| Table | Holds |
|---|---|
| `projects` | name, `target_budget`, status (`active`/`completed`/`paused`), notes |
| `expense_entries` | the original flat cost line — week number, description, category, trade, supplier, quoted/actual/paid amounts, VAT, status, paid date, receipt URL |
| `trade_lookups` | default hourly rate per trade — reference data, nothing joins to it |
| `project_weeks` | optional per-week `completion_pct` — **no longer editable from the UI and displayed nowhere** |

**The transaction core** (`0008`, run 2026-08-14) — eight more tables, because
`expense_entries` flattened the document and the item into one row:

| Table | Scope | Holds |
|---|---|---|
| `suppliers` | cross-project | `name`, `type`, `account_ref`, `notes` |
| `supplier_aliases` | cross-project | every spelling meaning that supplier |
| `items` | cross-project | `canonical_name`, `category`, `default_unit`, `pack_size`, `pack_unit` |
| `item_aliases` | cross-project | every spelling meaning that item |
| `purchases` | per project | one row per **document** — supplier, date, invoice no, net/VAT/gross, trade, category, status |
| `purchase_lines` | per project | the lines on that document — qty, unit, unit price, net, VAT |
| `payments` | per project | one row per time money changed hands |
| `receipts` | per project | attachments hung off the document |

**Ingestion tables:** `invoice_uploads` (`0010`, `0012`), and
`gmail_accounts` / `gmail_events` / `supplier_domains` (`0013`).

**Totals are never stored.** `gross_total` is a Postgres generated column;
everything else — `subtotal`, `vat_amount`, `total_incl_vat`, `remaining`,
`balance`, payment status — is derived on every read in
`lib/calculations.ts`, `lib/summary.ts`, `lib/purchases.ts` and
`lib/invoiceViews.ts`.

### 3.3 The screens that exist

Four nav destinations: **Dashboard · Invoices · Directory · Settings**.

| Route | Shows |
|---|---|
| `/dashboard` | project cards — Spent, Budget, % bar |
| `/projects/[id]` | the project, in **four tabs**: Overview · Costs · Invoices · Analysis |
| `/projects/[id]/labour/new` | log labour paid direct (person, trade, rate, hours, total, optional payment) |
| `/invoices`, `/invoices/upload`, `/invoices/new`, `/invoices/[id]/review` | the invoice-capture flow |
| `/directory`, `/suppliers`, `/items` (+ detail pages) | the cross-project register of merchants and materials |
| `/settings` | trade lookups, Gmail connection |

**Analysis** is one screen with four pivots of the same invoice-line dataset:
*By trade · By supplier · By material · Price history*, with a Labour/Materials
filter on the material pivot.

### 3.4 What works well today

- **Per-trade and per-line actual spend.** `buildTradeRows` and `materialLines`
  in `lib/invoiceViews.ts` give committed / net / VAT / gross / paid / balance
  per trade, per supplier and per individual invoice line.
- **A four-word money vocabulary** (`lib/vocabulary.ts`) — Committed, Cost,
  Paid, Owed — used identically on every screen, with Budget deliberately kept
  separate as a target rather than a derived figure.
- **Invoice capture that actually works on a phone**: photograph or drag in a
  file → AI extraction → a review screen showing the original beside a prefilled
  form with supplier/item fuzzy matching, duplicate detection and reconciliation
  warnings at the field they concern.
- **Gmail ingestion** — invoices emailed to a labelled mailbox are drained,
  deduped by file hash and queued for review automatically.
- **Price history per item**, with a genuine unit-mismatch guard: a bag-to-tonne
  change shows "check pack size" rather than a fake percentage.
- **Mobile-first design system** — one overlay primitive, one `Select`, one
  `DatePicker`, one icon set, every table rendered as both cards and a table.

### 3.5 What the data currently contains

Per `about.md` §13, the spreadsheet-imported dataset (111 diary rows, ~£151k)
has been **removed by the owner**; the project is being rebuilt invoice by
invoice, so `expense_entries` is empty or nearly so. The figures in `about.md`
§13 are history, not a live baseline.

---

## 4. Gap analysis, spec item by spec item

Legend: ✅ done · 🟡 partial · ❌ absent

### 4.1 Core Project Tracking

| Spec item | Status | Where it stands |
|---|---|---|
| Project/phase breakdown with target vs actual dates | ❌ | There are **no phases and no dates on work at all**. The only structuring axis is `week_number` — an integer on a cost line, carried over from the spreadsheet, with no start/end date, no name and no target. `project_weeks.completion_pct` exists but is hand-typed, feeds nothing and is not displayed. `projects` has no `start_date`/`end_date`: those columns existed in `0001` and were **dropped by `0002`** because the owner did not track them. |
| Budget vs actual spend per trade/line item | ✅ | This is the app's strongest feature — Analysis → *By trade* and *By material*, plus the Overview cards and the Costs tab footer. Note one honest gap: the **budget** side is a single project-level `target_budget`; there is no per-trade or per-phase budget to compare a trade's actual against. So it is really *committed vs actual*, not *budget vs actual*, at trade level. |
| Change orders / variations log | ❌ | Nothing. There is a `quoted_amount` / `quoted_gross` and a variance against it, which is the *result* of variations, but no record of what changed, why, when, who approved it, or what it did to the schedule. |
| Photo timeline tied to phase, dated and location-tagged | 🟡 → ❌ | Photos exist only as **invoice/receipt attachments** in the private `receipts` bucket, hung off a purchase document. There is no site-progress photo, no phase to tie one to, no capture date beyond upload, and no location tag. `expense_entries.location_room` is the only location field in the schema and it is free text on a cost line. |

### 4.2 People & Trades

| Spec item | Status | Where it stands |
|---|---|---|
| Subcontractor directory: contact info, insurance/cert expiry, day rates | ❌ | `suppliers` holds `name`, `type`, `account_ref`, `notes` — **no phone, email, address, insurance, certification or expiry**. And by deliberate design (`about.md` §6.6.1) **a worker is not a supplier**: labour is logged with the person's name on `purchase_lines.description_raw` and no supplier row at all, so subcontractors are not in the directory in any form. `trade_lookups.default_rate` is a rate per *trade*, not per person, and nothing joins to it. |
| Task assignment per trade with due dates | ❌ | There are no tasks. |
| Sign-off/approval flow when a trade completes a stage | ❌ | No stages, no approvals, no second user role. Note this collides with §3.1: the workspace has **no roles** — everyone signed in can edit everything — so an approval flow needs a permission concept the app currently does not have. |

### 4.3 Money

| Spec item | Status | Where it stands |
|---|---|---|
| Trade account invoices logged against the project | ✅ | Fully built, including AI extraction and Gmail ingestion. `suppliers.account_ref` even carries the trade account number. |
| **Purchase orders** | ❌ | The `purchases` table records a document that has *already been issued to you*. There is no outbound PO: no PO number, no "ordered but not yet delivered/invoiced" state, no ordered-vs-received quantities, no expected delivery date. `PURCHASE_ORIGINS` covers `manual`/`excel`/`text`/`invoice_ocr`/`legacy_import` — none of which is "we raised this order". |
| Running cashflow view: committed vs spent vs remaining budget | 🟡 | The **numbers exist and are correct** — Committed, Cost, Paid, Owed, Budget, Variance are on the Overview cards, with the same basis on the dashboard. What is missing is the word *running*: everything is a snapshot total. There is no time series of cash out, no forecast of what falls due when (there are no due dates), and the weekly chart is spend-by-week-number, not a cashflow curve. |
| Retention tracking (% held back from contractors) | ❌ | No concept. A retention would today have to be faked as a permanent balance on an invoice, which would sit in "Owed" for ever and be indistinguishable from an unpaid bill. |

### 4.4 Documents

| Spec item | Status | Where it stands |
|---|---|---|
| Planning / building control docs, warranties, certificates centralised | ❌ | The only file store is the `receipts` bucket and the `receipts` table, and a receipt row **must hang off a purchase**. There is no place to put a document that is not an invoice, no document type, no issue/expiry date, and no per-project document list. |
| Drawings/spec version control | ❌ | Nothing. No versioning of anything anywhere. |

### 4.5 Communication

| Spec item | Status | Where it stands |
|---|---|---|
| Activity log / notes per project (calls, site visits, decisions) | ❌ | There are `notes` free-text fields on `projects`, `expense_entries`, `purchases`, `suppliers` and `items` — but no dated, append-only log, no author, no entry type, and nowhere to record something that is not attached to a cost. |
| Snagging list with photo + status (open / fixed / verified) | ❌ | Nothing. "Snagging" appears in the spec only. |

### 4.6 Reporting

| Spec item | Status | Where it stands |
|---|---|---|
| Dashboard: budget variance across all live projects | 🟡 | `/dashboard` lists every project with Spent / Budget / % bar, and the Overview tab has a Variance card. So the money half exists at portfolio level, though in card form rather than as a comparison table. |
| Dashboard: **% complete** | ❌ | Cannot be computed. The only completion field, `project_weeks.completion_pct`, is hand-typed and unused. There is no task, phase or milestone from which a real percentage could be derived. |
| Dashboard: **days behind/ahead** | ❌ | Cannot be computed. There are no planned dates to be behind. |

### 4.7 Gantt chart — the whole of §7

**Status: ❌ absent, end to end.** Not partially built, not stubbed. There is no
task table, no dates on work, no dependency concept, no baseline, no scheduling
engine and no Gantt library in `package.json`. Every sub-item — dependencies,
knock-on auto-shift, critical path, float, baseline drift, per-task revision
log, cost-per-bar, inline cost impact on drag, portfolio Gantt, weather and
lead-time flags, "what if" simulation — is greenfield.

Two things about the existing app that a Gantt implementation must respect:

1. **`week_number` is the only time axis that exists**, and it is an integer on
   a cost line with no anchor to a calendar. Any schedule work has to decide
   whether weeks map onto real dates or are replaced outright.
2. **Cost is attached to a *document*, not to a piece of work.** A `purchase`
   has a supplier, a trade and a project — but nothing that says "this is part
   of the first-fix electrics task". Tying cost to schedule (the spec's stated
   must-have) therefore needs a new link from `purchases`/`purchase_lines` (and
   `expense_entries`) to a task or phase. That link is the single most important
   piece of plumbing in the whole spec, because every §7 "cost tied to schedule"
   feature and the §6 "% complete" and "days behind" figures depend on it.

---

## 5. Scoreboard

| Spec section | Items | ✅ | 🟡 | ❌ |
|---|---|---|---|---|
| 1. Core Project Tracking | 4 | 1 | 0 | 3 |
| 2. People & Trades | 3 | 0 | 0 | 3 |
| 3. Money | 4 | 1 | 1 | 2 |
| 4. Documents | 2 | 0 | 0 | 2 |
| 5. Communication | 2 | 0 | 0 | 2 |
| 6. Reporting | 3 | 0 | 1 | 2 |
| 7. Gantt (grouped) | ~14 | 0 | 0 | ~14 |

**Done: 2 of ~32.** Both are money features, and both are the ones the spec's
Priority Note calls must-have on the budget side.

---

## 6. What has to be built, grouped by what it depends on

This is a dependency ordering, not a schedule or a commitment — it says what
cannot be started before what.

### Foundation A — a schedule model (unblocks the majority of the spec)

Nothing in §1 (phases/dates), §2 (task assignment, sign-off), §6 (% complete,
days behind/ahead) or §7 (all of it) can begin without this.

Roughly what it needs:

- **`phases`** — per project: name, order, target start/end, actual start/end.
  The spec names demo / first fix / second fix / snagging as examples, so the set
  should be editable, not hard-coded.
- **`tasks`** — per phase: name, trade, assignee, planned start/end, actual
  start/end, `% complete` or a status, and a **budget**.
- **`task_dependencies`** — predecessor, successor, type (`FS`, `SS`, at
  minimum), lag.
- **`task_baselines`** — the original planned dates, frozen, so drift can be
  shown against them.
- **`task_revisions`** — an append-only per-task log with a reason (material
  delay / weather / client change / trade no-show / other), which is also
  §7's change-tracking requirement.
- **A link from money to work** — `task_id` (nullable) on `purchases`, on
  `purchase_lines`, and on `expense_entries`. Without it "each bar carries an
  actual cost" is impossible.

### Foundation B — a people model

Blocks §2 entirely, and the assignee field in Foundation A.

- **`contacts`** (or extend `suppliers` — but note the deliberate rule that a
  worker is *not* a supplier): name, trades, phone, email, address, day rate.
- **`contact_certifications`**: type (public liability, Gas Safe, NICEIC…),
  reference, issue date, **expiry date**, scanned document — with expiry
  surfaced somewhere visible.
- A **role/permission concept** if sign-off is to mean anything, because today
  every signed-in user is an unrestricted editor (§3.1).

### Foundation C — a general document and photo store

Blocks §1's photo timeline, §4 entirely, and §5's snagging photos.

- **`documents`**: project, type (planning / building control / warranty /
  certificate / drawing / spec / photo), title, file, issue and expiry dates,
  **version number and supersedes-link**, current-version flag.
- Photos need **capture date and location** (phase, room, or free text) as
  first-class fields, not filename conventions.
- The existing `receipts` bucket and table can stay as they are — invoice
  attachments are a different thing with a different lifecycle.

### Then, on top of those

- **Gantt UI + scheduling engine** (§7) — needs A. This is the largest single
  piece: forward/backward pass for early/late dates and float, critical path,
  auto-shift of dependents, drag-and-drop, a baseline overlay, inline cost
  impact, a "what if" scratch mode that does not write, and a portfolio roll-up.
- **Change orders / variations log** (§1) — needs A for the schedule impact, and
  links to existing money for the cost impact.
- **Purchase orders and retention** (§3) — need neither A nor B strictly, and
  could be done independently of the schedule work. Retention in particular is a
  small, self-contained change to how a purchase's balance is derived, and is
  the cheapest unbuilt money feature in the spec.
- **Activity log and snagging** (§5) — snagging needs C for photos and benefits
  from B for assignment.
- **Portfolio dashboard with % complete and days behind/ahead** (§6) — needs A.

### The cheapest useful things

If the aim is early visible progress rather than strict dependency order, three
items are small and independent of the schedule work:

1. **Retention tracking** — a percentage held back on a purchase, excluded from
   Owed and tracked as a separate release-due figure.
2. **Contact details on suppliers** — phone, email, address, day rate are four
   columns and four form fields on a table and a screen that already exist.
3. **A project activity log** — one table, one list, one form; no dependencies.

---

## 7. Things to decide before any of this is designed

These are genuine forks where the answer changes the work substantially, and
none of them can be settled from the PDF alone.

1. **Is `week_number` kept?** The whole existing dataset and the Costs tab are
   organised by it. Real phases with real dates either replace it, or sit
   alongside it and the two have to be reconciled.
2. **Single site or portfolio?** The spec asks twice for cross-project views
   ("all live projects at once", "multi-project Gantt"), but the app is one
   shared workspace built around one address and its RLS has no tenancy. Several
   real renovations in one workspace is a different product from what `0015`
   assumes.
3. **Who signs things off?** Sign-off and approval imply at least two roles.
   Today everyone signed in is an unrestricted editor by explicit design.
4. **How is a task's actual cost defined?** Sum of purchase lines tagged to it,
   sum of whole documents tagged to it, or a manually maintained figure? This
   decides whether the link in Foundation A is at line level or document level.
5. **Is progress typed in or derived?** "% complete" can be hand-entered per
   task, derived from task status, or derived from cost spent against budget.
   The last one is tempting and usually wrong on renovations.
6. **Where do weather and lead-time flags come from?** A weather API tied to the
   site postcode is a real integration with a real cost; a manually flagged
   "weather-dependent" tag on a task is an afternoon's work. The spec does not
   say which it wants.

---

## 8. Notes on scale

For context on the size of the ask: the existing app is ~15 migrations, 4 + 8 +
4 tables, ~60 route/page files and ~50 components, and covers roughly 2 of the
spec's ~32 items. The spec is not an increment on this codebase — it is a
second, larger application (scheduling) bolted onto the first (cost tracking),
with the join between them being the `task_id` link described in §6.
