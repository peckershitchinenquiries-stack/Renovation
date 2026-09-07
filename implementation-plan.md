# Implementation plan — building the feature spec into RenovaTrack

**Written:** 2026-09-03
**Companion document:** [`feature-spec-gap-analysis.md`](./feature-spec-gap-analysis.md) —
what the spec asks for, and what exists today. Read that first; this document
assumes it.
**Status:** a plan only. **No code, schema, data or migration has been changed.**

---

## 0. How to read this

The work is split into **ten phases across two tracks**. Track A is the
schedule — it is one long dependency chain and it is most of the spec. Track B
is the money and admin features, which depend on nothing and can be built at any
time, including first.

Every phase below states:

- **Goal** — what a person can do at the end of it that they couldn't before
- **Migration** — the SQL file, its number, and what it creates
- **Code** — the `lib/`, `app/api/` and `components/` files it adds or touches
- **Done when** — a test a non-developer can perform
- **Risks** — what is most likely to go wrong

**Every phase ends the same three ways**, and these are not repeated in each
section:

1. `npm run build` passes (the only full typecheck — there is no test suite).
2. An entry is added to `updates.md`, per the mandatory rule in `CLAUDE.md`.
3. `about.md` is updated if the phase changed how anything works — which, from
   Phase 1 onward, every phase does.

### House rules every phase must obey

These come from `CLAUDE.md` and `about.md` and are not negotiable:

- **Never persist a computed total.** Float, critical-path membership, task
  actual cost, % complete, days behind — all of these are derived on read, in
  `lib/`, exactly as `computeEntry`, `computePurchase` and `buildTradeRows`
  already are. The one exception the codebase allows is a Postgres **generated**
  column (`purchases.gross_total`), which is the same rule enforced by the
  database instead of by TypeScript.
- **Never add `.eq("user_id", …)` to a query.** RLS scopes everything. But a new
  table with **no policy returns nothing**, and with RLS disabled leaks
  everything — so every new table in this plan needs the `shared workspace`
  policy in the same shape as `0015`, plus `grant … to authenticated`.
  `0014` already set default privileges for `service_role` on future tables.
- **Migrations are run by hand**, pasted into the Supabase SQL editor in
  filename order. Writing the file does not apply it. Every phase must say
  plainly that the migration still has to be run.
- **`source` / `entry_source` still splits diary from ledger.** Nothing in this
  plan sums across them. New tables that carry money (retention, POs) inherit
  the same split or deliberately sit outside it, and say which.
- **Tables render twice** — a `sm:hidden` card list and a `hidden sm:block`
  table, from the same array. Add a column to one, add it to both.
- **Use the design system**: `.btn-*`, `.input`, `.card`, `.row` from
  `globals.css`, and the primitives in `components/ui/` (`Sheet`, `Select`,
  `DatePicker`, `Icon`, `PageHeader`, `List`, `Badge`, `StatCard`). No native
  `<select>` and no `<input type="date">` — there are none left in the codebase
  and none should come back.
- **Nothing fixed to the bottom of the screen goes inside `PageHeader`.** It is
  `backdrop-blur-xl`, which makes it the containing block for `position: fixed`
  children. This has already caused one real bug (2026-09-01).

### Migration numbering

The last file is `0015_shared_workspace.sql`. This plan uses **`0016` onward**,
one migration per phase, numbered in the order the phases are listed. If phases
are built out of order, the migration numbers follow the **build** order, not
the order here — filename order is execution order.

> ⚠️ **Check `0015` has actually been run before starting.** Its header still
> carries a `STATUS: NOT YET RUN` banner while `CLAUDE.md` describes the app as
> already being on the shared-workspace policy. Every new table in this plan
> copies `0015`'s policy shape, so it matters which one is true. Confirm in the
> SQL editor with
> `select tablename, policyname from pg_policies where schemaname = 'public';`
> before writing `0016`.

---

## 1. The six decisions, and what this plan assumes

The gap analysis ended with six open questions. A plan cannot be written without
answers, so this plan **assumes** the following. Each is a real fork — if the
owner disagrees with one, say so before that phase starts, because changing it
later is expensive.

| # | Question | This plan assumes | Why, and what changes if reversed |
|---|---|---|---|
| 1 | Is `week_number` kept? | **Kept, and derived.** Phases and tasks carry real dates. `week_number` stays on `expense_entries` and `purchases` exactly as it is; the project gains a `start_date`, and week N becomes a *display* derived from it. Nothing is migrated or renamed. | Removing `week_number` means touching the Costs tab's week grouping, its subtotals, `buildByWeek`, the weekly chart and every deep link — a large change with no user-visible gain. Keeping it costs one nullable column on `projects`. |
| 2 | Single site or portfolio? | **Portfolio-capable from day one, single-site in practice.** Every schedule table is `project_id`-scoped, and the portfolio views in Phase 8 aggregate across projects. No tenancy is added. | The spec asks twice for cross-project views. Building project-scoped tables costs nothing extra now; retrofitting a `project_id` onto a single-project schema later costs a migration and a backfill. |
| 3 | Who signs things off? | **Anyone signed in can sign off, and the app records who and when.** No roles, no permission enforcement. | This matches the existing trust model exactly (§9.1 of `about.md`: signing in is the whole authorisation model). A real role system means changing every RLS policy in the database and is a project of its own — it should be its own decision, not a side effect of building sign-off. The sign-off *record* is the valuable part and it works without roles. |
| 4 | How is a task's actual cost defined? | **Line level.** `task_id` goes on `purchase_lines` and on `expense_entries`. A task's actual cost is the sum of lines tagged to it. The invoice form gets a "tag the whole invoice to a task" control that writes the same `task_id` onto every line — convenience, not a second source of truth. | Tagging at document level as well would create two places to sum from and one of them would eventually double-count. One authoritative level, one query. |
| 5 | Is progress typed in or derived? | **Typed in, per task, with an optional cost-based figure shown beside it — never instead of it.** Project % complete is the duration-weighted mean of task progress. | Deriving progress from spend is the classic renovation error: it reports 90% done the day a large material order lands. Showing both, clearly labelled, is honest and costs nothing. |
| 6 | Where do weather and lead-time flags come from? | **Manual flags first** (`weather_sensitive`, `lead_time_days` on a task), with a live weather API as an optional, separable Phase 10. | A flag is an afternoon; an integration is a paid API key, a site postcode, a cron and a failure mode. The flag delivers most of the value — "this bar is weather-dependent and it's in February" — with none of the operational cost. |

Two further decisions that arise inside the work, resolved here:

| Question | This plan assumes |
|---|---|
| **Gantt: library or in-house?** | **In-house**, rendered with CSS grid bars and an SVG dependency overlay, on top of a pure-TypeScript scheduler in `lib/schedule.ts`. Reasons in §5.3. `frappe-gantt` is the named fallback if the drag interaction proves harder than estimated. |
| **Where does the scheduling maths live?** | `lib/schedule.ts` — pure functions, no I/O, no React, mirroring `lib/summary.ts` and `lib/purchases.ts`. This is what makes the "what if" simulation of Phase 9 nearly free: it is the same function run over a modified copy that is never saved. |

---

## 2. The shape of the whole thing

```
TRACK A — the schedule (one chain, must be built in order)

  Phase 1  Schedule core        phases · tasks · dependencies · baselines · revisions
     │                          + list UI. No Gantt yet.
     ▼
  Phase 2  Cost ⇄ schedule      task_id on purchase_lines + expense_entries
     │                          per-task budget vs actual. ← the spec's must-have
     ▼
  Phase 3  Scheduling engine    lib/schedule.ts — forward/backward pass, float,
     │                          critical path, auto-shift. Pure functions + a
     │                          plain "Schedule" table view. Still no chart.
     ▼
  Phase 4  Gantt v1             the chart: bars, dependency arrows, drag,
     │                          baseline overlay, inline cost impact
     ▼
  Phase 8  Portfolio reporting  % complete, days behind/ahead, multi-project
     │                          dashboard and rolled-up Gantt
     ▼
  Phase 9  Practical extras     "what if" simulation, weather/lead-time flags

TRACK B — independent of the schedule (build any time, in any order)

  Phase 5  People & trades      contacts · certifications & expiry · day rates
                                · task assignment (needs Phase 1) · sign-off
  Phase 6  Documents & photos   document store · versioning · photo timeline
                                (photo timeline's phase link needs Phase 1)
  Phase 7  Communication        activity log · snagging list
  Phase B1 Money gaps           retention tracking · purchase orders
                                · change orders (schedule impact needs Phase 1)
```

### Recommended build order

1. **Phase B1a — retention tracking.** Small, self-contained, real money, no
   dependencies. Proves the plan's shape on something low-risk.
2. **Phase 5a — contact details on suppliers/contacts.** Four columns and four
   fields on screens that already exist.
3. **Phase 1 → 2 → 3 → 4.** The main chain. Phase 2 is where the spec's stated
   must-have — cost tied to schedule — actually lands, and it lands *before* the
   chart, which is deliberate: the numbers are worth having even as a table.
4. Everything else, by whatever the owner most wants next.

**Why Phase 2 before Phase 3 and 4:** the Priority Note says budget drift going
unnoticed is the failure mode. Per-task budget vs actual, shown as a table, is
the whole of that value. The Gantt makes it *visible*, but a chart that draws
correct bars over untagged costs delivers nothing the app doesn't already have.

---

## 3. Phase 1 — schedule core

**Goal.** A project can be broken into phases (demo, first fix, second fix,
snagging — editable, not hard-coded), each holding tasks with a trade, a
planned start and end, an actual start and end, a status and a budget. Tasks can
be linked to each other. Every change to a task's dates is logged with a reason.
No chart yet — this is a list.

### Migration `0016_schedule_core.sql`

Six new tables, plus two columns on `projects`.

**`projects`** — two added columns:

| Column | Type | Note |
|---|---|---|
| `start_date` | `date` | the anchor `week_number` is measured from. Nullable — an unanchored project just shows no week dates. |
| `planned_end_date` | `date` | the target completion, for "days behind/ahead" |

> These two were in `0001` and dropped by `0002` because the owner did not track
> them. They come back because the spec asks for target-vs-actual dates.
> `address`, `end_date` and `contingency_pct` stay dropped.

**`project_phases`**

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | → `auth.users(id)` cascade — provenance, per `0015` |
| `project_id` | uuid | → `projects(id)` cascade |
| `name` | text not null | `check (btrim(name) <> '')` |
| `sort_order` | integer not null | `unique (project_id, sort_order)` deferred, or just indexed |
| `colour` | text | one of a fixed set, for the Gantt band. Nullable. |
| `target_start` / `target_end` | date | the phase's own target, independent of its tasks |
| `notes` | text | |
| `created_at` / `updated_at` | timestamptz | `updated_at` by trigger, same pattern as `trg_projects_updated` |

Phase *actual* dates are **derived**, not stored: min of its tasks' actual
starts, max of their actual ends. Storing them would be a computed total.

**`tasks`**

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id` / `project_id` | uuid | cascade |
| `phase_id` | uuid | → `project_phases(id)` **on delete set null** — deleting a phase must not destroy its work |
| `name` | text not null | |
| `trade` | text | free text, matched against `trade_lookups.name` by convention only — **no FK**, exactly like `purchases.trade` |
| `assignee_contact_id` | uuid | → `contacts(id)` on delete set null — **added in Phase 5**, not here |
| `planned_start` / `planned_end` | date | nullable while a task is being sketched |
| `actual_start` / `actual_end` | date | nullable |
| `duration_days` | integer | `check (duration_days is null or duration_days > 0)`. See the note below. |
| `progress_pct` | numeric(5,2) | `check (between 0 and 100)`, default 0 — hand-entered, per decision 5 |
| `status` | text | `Not started` \| `In progress` \| `Blocked` \| `Complete` \| `Cancelled` — a CHECK, and **not** the same vocabulary as `entry_status`; a task is not a payment |
| `budget_amount` | numeric(12,2) | `check (>= 0)`. **Ex-VAT**, to match `actual_amount` and `line_net`. This is per-task budget — the thing that is missing today. |
| `weather_sensitive` | boolean not null default false | Phase 9 uses it; the column costs nothing now |
| `lead_time_days` | integer | ditto |
| `notes` | text | |
| `sort_order` | integer | display order within the phase |
| `created_at` / `updated_at` | timestamptz | trigger |

> **Why both dates and a duration.** A scheduler needs to know which of the two
> is authoritative when a task shifts. The rule: **`duration_days` is
> authoritative, dates are derived from it plus the dependency constraints** —
> except for a task with no predecessors, where `planned_start` is the anchor.
> This is what makes auto-shift possible at all. It is stated here rather than
> discovered in Phase 3.

**`task_dependencies`**

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id` / `project_id` | uuid | cascade |
| `predecessor_id` / `successor_id` | uuid | → `tasks(id)` cascade |
| `dep_type` | text not null default `'FS'` | `check in ('FS','SS','FF','SF')`. The spec names FS and SS; the other two are one CHECK value each and their absence is more annoying than their presence. |
| `lag_days` | integer not null default 0 | can be negative (a lead) |

Constraints that matter:
- `unique (predecessor_id, successor_id)` — one link per pair
- `check (predecessor_id <> successor_id)` — no self-link
- **Cycle prevention is not a database constraint.** Postgres cannot express it
  cheaply. It is enforced in `lib/schedule.ts` (`detectCycle`) and refused by
  the API route with a 400 naming the loop. Stated explicitly so nobody assumes
  the database is guarding it.

**`task_baselines`** — the "original planned dates" the spec's drift view needs.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id` / `project_id` / `task_id` | uuid | cascade |
| `baseline_name` | text not null default `'Baseline 1'` | so a re-baseline after a major variation is possible |
| `planned_start` / `planned_end` | date | frozen copies |
| `duration_days` | integer | |
| `budget_amount` | numeric(12,2) | **the budget is baselined too** — otherwise "budget drift" has nothing to drift from |
| `captured_at` | timestamptz not null default now() | |
| `captured_by` | uuid | → `auth.users(id)` on delete set null |

`unique (task_id, baseline_name)`. A baseline is captured for a whole project at
once, by a **"Set baseline"** action — never automatically, and never silently
overwritten.

**`task_revisions`** — the per-task change log, which is §7's change-tracking
requirement and §1's variations log at task level.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `user_id` / `project_id` / `task_id` | uuid | cascade |
| `changed_at` | timestamptz not null default now() | |
| `changed_by` | uuid | → `auth.users(id)` on delete set null |
| `field` | text not null | what moved: `planned_start`, `planned_end`, `duration_days`, `budget_amount`, `status`, `progress_pct` |
| `old_value` / `new_value` | text | stored as text — this is a log, not a calculation input |
| `reason_code` | text | `check in ('material_delay','weather','client_change','trade_no_show','scope_change','other')` or null |
| `reason_note` | text | free text |
| `shift_source` | text not null default `'manual'` | `check in ('manual','knock_on')` — **this is important**: an auto-shifted downstream task gets a revision row too, marked `knock_on`, so the log tells you which slips were decisions and which were consequences |

**RLS and grants for all six** — copy `0015`'s shape exactly:

```sql
alter table public.<t> enable row level security;
create policy "shared workspace" on public.<t>
  for all to authenticated using (true) with check (true);
grant all privileges on public.<t> to authenticated;
```

`0014`'s `alter default privileges` should already cover `service_role`; the
migration asserts it rather than assuming, in the same `do $$ … $$` style
`0014` uses.

### Code

**`types/index.ts`** — `ProjectPhase`, `Task`, `TaskStatus`, `TaskDependency`,
`DepType`, `TaskBaseline`, `TaskRevision`, `ReasonCode`, plus the `*_INPUT`
shapes and the `TASK_STATUSES` / `DEP_TYPES` / `REASON_CODES` const arrays that
drive the `Select` options — following the existing pattern at the bottom of the
file exactly.

**`lib/schedule.ts`** — created here but nearly empty in this phase: just
`taskDurationDays`, `phaseActualDates` (derived, per above) and
`taskProgressRollup`. The engine arrives in Phase 3.

**`lib/scheduleWrite.ts`** — the write path, modelled on
`lib/purchaseWrite.ts`. One `createTask` / `updateTask` / `deleteTask`, and
critically **one `recordRevision` helper that every write goes through**, so a
date can never move without a log row. Phase 3's auto-shift calls the same
helper with `shift_source: 'knock_on'`.

**`lib/data.ts`** — `getScheduleBundle(projectId)`: phases, tasks, dependencies,
the current baseline and the last N revisions, in the two-pass style
`getProjectBundle` already uses (`selectIn` for the child tables).

**`lib/validation.ts`** — `validateTask`, `validatePhase`, `validateDependency`.
Same `ValidationErrors` shape and `hasErrors` as everything else.

**API routes** — all under `app/api/projects/[id]/`, all using `requireUser()`
and the early-return-on-`response` pattern:

```
schedule/                 GET   the whole bundle
schedule/phases/          POST  · [phaseId]/ PATCH DELETE
schedule/tasks/           POST  · [taskId]/  PATCH DELETE
schedule/dependencies/    POST  · [depId]/   DELETE
schedule/baseline/        POST  capture · GET current
```

**Screens**

- A fifth project tab, **Schedule**, key `schedule`, in `ProjectDetail.tsx`'s
  `TABS`. Five tabs is one more than the four the 2026-08-28 collapse settled
  on — justified because this is a genuinely different dataset, not another
  `group by` of the invoice lines.
- `components/project/ScheduleTab.tsx` — phases as collapsible groups, tasks as
  rows: name, trade, planned dates, actual dates, status chip, progress,
  budget. Card list on mobile, table from `sm:`.
- `components/forms/TaskForm.tsx` in a `Sheet` — every field above, with
  `DatePicker` for dates and `Select` for status/trade/phase. Trade reuses
  `components/forms/TradeSelect.tsx` unchanged.
- `components/schedule/DependencyEditor.tsx` — pick predecessor, type, lag, from
  within the task sheet.
- **A reason prompt.** When a save moves `planned_start`, `planned_end` or
  `duration_days` on a task that has a baseline, the sheet asks for a reason
  code before it will save. This is the single most valuable thing in the phase
  and it is cheap: the log is worthless if it's optional.

**Done when.** The owner can open 46 Glenferrie Road, create the phases demo /
first fix / second fix / snagging, add ten tasks under them with dates and
budgets, link "plasterer" after "first fix", set a baseline, then push a date
out and be asked why — and see that reason in the task's history.

**Risks.**
- *Scope creep into the Gantt.* Resist it. This phase ends with a table.
- *The duration-vs-dates rule.* If it isn't held to, Phase 3's auto-shift will
  have no defined behaviour. Write it into `about.md` in this phase, not later.
- *Cycles.* `detectCycle` must exist before dependencies can be created, even
  though the engine doesn't. It's ~20 lines of DFS.

---

## 4. Phase 2 — cost tied to the schedule

**This is the spec's stated must-have.** It is deliberately before the chart.

**Goal.** Any invoice line, and any hand-entered cost, can be tagged to a task.
Every task then shows **budget vs committed vs actual vs paid**, live, and every
phase and the project roll those up. Budget drift is visible at the line the
spec asks for it at.

### Migration `0017_task_cost_link.sql`

Three nullable columns and their indexes. Nothing is backfilled and nothing
moves:

| Table | Column | Note |
|---|---|---|
| `purchase_lines` | `task_id uuid references public.tasks(id) on delete set null` | **the authoritative link** (decision 4) |
| `expense_entries` | `task_id uuid references public.tasks(id) on delete set null` | the hand-entered half |
| `tasks` | — | nothing added; `budget_amount` came in `0016` |

Indexes: `idx_purchase_lines_task`, `idx_expense_entries_task`.

`on delete set null` and not cascade, deliberately: **deleting a task must never
delete money.** An untagged cost is a reporting gap; a deleted invoice line is a
lost record.

### Code

**`lib/scheduleCosts.ts`** — new, and the heart of the phase. Pure functions,
nothing stored:

| Function | Returns |
|---|---|
| `taskCostRows(tasks, invoiceLines, entries, payments)` | per task: `budget`, `committed`, `cost`, `paid`, `owed`, `variance`, `variance_pct`, `line_count` |
| `phaseCostRows(...)` | the same, rolled up per phase, plus an `untagged` bucket |
| `projectCostRollup(...)` | budget vs cost for the project, and the **untagged total** |
| `costImpactOfShift(task, days, rates)` | Phase 4 uses it; defined here — see below |

Rules it must follow, all inherited:

- **Money vocabulary**: the four words from `lib/vocabulary.ts` — Committed,
  Cost, Paid, Owed — used on every new screen. **Budget** stays separate as a
  target, which is exactly what `budget_amount` is.
- **VAT basis**: `budget_amount` is ex-VAT, so it is compared against
  `line_net`, **not** `line_gross`. A task card showing budget vs incl-VAT cost
  would repeat the 2026-08-06 double-VAT error in a new place. The screen labels
  the basis.
- **Cancelled excluded**: `ACTIVE_PURCHASE` (`entry_status !== 'Cancelled'`)
  and the existing `ACTIVE` filter apply, same as everywhere.
- **Diary/ledger**: `buildInvoiceLines` already drops nothing by source and the
  Analysis tab combines at the last moment via `components/purchases/totals.ts`.
  Follow that precedent — group by `entry_source` internally, combine for
  display only.

**The untagged bucket is a feature, not a gap.** Every screen that shows
per-task cost also shows *"£X on N lines not tagged to a task"* with a link that
filters to them. Without it, a project can look perfectly on budget because half
its spend is invisible to the roll-up. This is the single most likely way this
phase produces a comforting lie, and the counter is one number on screen.

**Tagging, in three places:**

1. **`components/forms/PurchaseForm.tsx`** — a `Select` per line, plus one
   "Apply to all lines" control at document level that writes the same `task_id`
   to every line (decision 4: convenience, not a second source of truth). Task
   options come from the chosen project, so the existing `next_week_by_project`
   pattern — re-defaulting when the project changes without overwriting a
   hand-typed value — applies to tasks too.
2. **`components/forms/ExpenseForm.tsx`** — one `Select`.
3. **`components/forms/LabourForm.tsx`** — one `Select`. Labour against a task
   is the most valuable tag of the three, because a waiting trade is what the
   spec's cost-impact example is about.

**Screens**

- **Schedule tab**: every task row gains `Budget · Cost · Variance`, with the
  variance chip pattern the Costs tab already uses (over red, under green, "on
  budget" grey). Both renders — card and table.
- **Analysis tab**: a fifth pivot, **By task**, through the existing
  `PivotTable` shell. This is nearly free and it is where the spec's
  "budget vs actual per trade/line item" becomes "…per task".
- **Overview tab**: one sentence, in the style of the existing invoice
  sentence — *"£X of £Y committed against tasks; £Z untagged."*

**Done when.** The owner tags last week's Lawsons invoice to "first fix
carpentry", and the task immediately shows £1,200 budget → £1,430 cost, +19%,
in red, on the Schedule tab and in the By-task pivot — without a spreadsheet.

**Risks.**
- *VAT basis.* Called out above because it is the mistake this codebase has
  already made once.
- *Tagging never happens.* A tag that is optional and buried gets skipped, and
  then every task reads £0. Mitigations: the untagged bucket on screen, the
  task `Select` placed next to the trade field (which is already filled in
  habitually), and "apply to all lines" so a single-task invoice is one click.

---

## 5. Phase 3 — the scheduling engine

**Goal.** Dates, float and the critical path are computed from the dependency
graph. Moving one task moves the ones that depend on it, and the app says which
tasks are actually driving the completion date. Still no chart — the output is a
table with a "Critical" badge, an "Auto-shift preview" dialog, and correct
numbers. The chart in Phase 4 then has nothing to compute.

### Migration

**None.** This phase adds no columns and no tables. That is the point of putting
the maths in `lib/`.

### Code

**`lib/schedule.ts`** — grows into the engine. All pure, all synchronous, no
React, no Supabase. Testable with the existing `node --test` setup
(`lib/purchases.test.mts` is the precedent — **write `lib/schedule.test.mts`
alongside it; this is the one phase in the plan where the maths is intricate
enough that the absence of a test suite genuinely hurts**).

| Function | Does |
|---|---|
| `detectCycle(deps)` | DFS; returns the offending path or null. Already needed in Phase 1 |
| `topoSort(tasks, deps)` | execution order |
| `forwardPass(tasks, deps, calendar)` | earliest start / earliest finish per task |
| `backwardPass(…)` | latest start / latest finish, from the project end |
| `computeFloat(…)` | `total_float = LS − ES`; `free_float` too |
| `criticalPath(…)` | tasks with `total_float <= 0`, as a set |
| `scheduleProject(bundle)` | the one entry point: everything above, returning `ScheduledTask[]` |
| `applyShift(bundle, taskId, newDates)` | returns a **new** bundle with downstream tasks moved — never mutates, never writes |
| `driftVsBaseline(scheduled, baseline)` | per task and per project: days early/late on start and finish |
| `workingDaysBetween(a, b, calendar)` | see the calendar note |

**The working calendar.** A five-day week with configurable non-working days is
the minimum that is not wrong — a plasterer does not work Sunday, and a schedule
that says so drifts by a day a week. Implementation: a small
`WorkCalendar` type (`working_weekdays: number[]`, `holidays: string[]`) held in
`projects.notes`? **No** — that would be storing structured data in free text.
It gets two real columns in this phase's *absence* of a migration, which is a
contradiction, so: **`0018_work_calendar.sql` adds
`projects.working_weekdays smallint[]` (default `{1,2,3,4,5}`) and
`project_holidays (project_id, holiday_date, name)`.** One small migration; the
phase otherwise stays pure.

**Auto-shift, and the rule that makes it safe.** The spec asks for the knock-on
effect. The dangerous version silently rewrites twenty rows. The version this
plan builds:

1. The user changes a task's dates.
2. `applyShift` computes the consequence **in memory** and the UI shows *"This
   moves 6 downstream tasks; completion goes 27 Nov → 4 Dec"* with the list.
3. **Nothing is written until it is confirmed.**
4. On confirm, one API call writes the moved tasks **and a `task_revisions` row
   per task with `shift_source = 'knock_on'`**, carrying the originating task's
   reason code.

That last point is what makes the revision log worth reading: six months later
it says "this slipped because the steels were late", not "this slipped".

**API routes**

```
app/api/projects/[id]/schedule/shift/     POST  { task_id, planned_start,
                                                  planned_end, reason_code,
                                                  reason_note, confirm: boolean }
```

With `confirm: false` it returns the preview and writes nothing — the same
request shape both times, so the preview can never disagree with what gets
saved. That symmetry is worth more than a saved round trip.

**Screens.** Schedule tab gains: a **Critical** badge on critical tasks, a
**Float** column (`— ` for critical, `+4d` otherwise), a **Drift** column
(baseline vs current, `+6d` in red), a project header line reading
*"Completion 4 Dec · 7 days behind baseline"*, and the auto-shift confirm
dialog (a `Sheet`, like every other overlay).

**Done when.** The owner pushes "first fix electrics" out three days, is told
exactly which four tasks move and that completion goes out two days (not three —
because one of them had a day of float), confirms, and finds all five changes in
the history with the reason attached.

**Risks.**
- *This is real algorithmic code in a codebase with no tests.* Hence
  `lib/schedule.test.mts`. Non-negotiable for this phase.
- *Calendar edge cases* — a task starting on a Friday with a 3-day duration.
  Pin the behaviour down with tests, in the test file, first.
- *Performance* is a non-issue: a domestic renovation is tens of tasks, not
  thousands. Do not build for scale that will not arrive.

---

## 6. Phase 4 — Gantt v1

**Goal.** The chart the spec calls core: bars on a timeline, grouped by phase,
with dependency arrows, drag to move or resize, a baseline ghost behind each
bar, critical path highlighted, and **the cost implication of a drag shown
inline, on the bar, before it is committed**.

### Migration

None.

### 6.1 Why in-house rather than a library

- The scheduling maths already lives in `lib/schedule.ts` (Phase 3) because
  critical path and cost impact are needed by non-chart screens. A Gantt library
  brings its own engine, and then there are two — which will disagree.
- **This app is used almost entirely on phones** (`about.md`, the 2026-08-28 nav
  rewrite). Every mature Gantt library is a desktop, mouse-first, dense-grid
  control. Making one of them work at 375px is not obviously less work than
  drawing bars.
- The design system is specific and consistently applied. A library brings its
  own CSS and its own controls, which is exactly the drift the `components/ui/`
  primitives exist to prevent.
- Inline cost-impact-on-drag is a custom render on the bar in every case.

**Fallback:** if drag proves harder than estimated, `frappe-gantt` (MIT, ~30kB,
no React dependency, renders SVG) can drive the bars while `lib/schedule.ts`
stays authoritative for the maths. Decide this at the end of the first week of
the phase, not at the start.

### 6.2 Code

**`components/schedule/Gantt.tsx`** — the shell: a scrollable timeline with a
sticky left task column, one row per task, phases as bands.
**`components/schedule/GanttBar.tsx`** — one bar: planned span, a lighter
**baseline ghost** behind it, a progress fill, critical-path styling, and drag
handles at each end and in the middle.
**`components/schedule/DependencyArrows.tsx`** — one absolutely-positioned SVG
over the grid, elbow connectors per dependency, critical links emphasised.
**`components/schedule/CostImpactChip.tsx`** — appears attached to the bar
*during* a drag: *"+3 days · scaffold +£180 · Dave 3 × £220 = +£660"*.
**`components/schedule/TimelineScale.tsx`** — day/week/month zoom.

**Cost impact, honestly.** `costImpactOfShift` in `lib/scheduleCosts.ts`
(Phase 2) computes it, and it must only claim what it can evidence:

- **Day-rate cost** — the task's assigned contact's day rate (Phase 5) or the
  trade's `trade_lookups.default_rate` × 8, × extra days. Labelled as an
  estimate, and it says which rate it used.
- **Time-based hire** — any task flagged as a hire (a `hire_daily_rate` column,
  nullable, added here in `0019_hire_rate.sql`) contributes rate × extra days.
  Scaffold is the spec's own example and it is the common case.
- **Nothing else.** If a task has neither, the chip says *"no rate on file — no
  cost estimate"* rather than showing £0, which would read as "this delay is
  free". A wrong number here is worse than no number: it is exactly the kind of
  figure that gets quoted at a client.

**Mobile.** A Gantt on a 375px screen is not the desktop chart made smaller. The
plan: **horizontal scroll with a sticky task column, one-week viewport by
default, tap-to-select a bar then adjust dates in a `Sheet` — no drag.** Drag on
touch fights the page scroll and the results are imprecise on a bar four pixels
tall. The desktop gets drag; the phone gets the same operation through the same
API with a form. Both show the same cost impact before confirming.

**Done when.** On a laptop, the owner drags the plastering bar three days right;
four downstream bars move with it as a preview, an amber chip on the bar says
`+3 days · +£840`, and the completion marker moves. Nothing is saved until
"Apply" — and on a phone, the same change is possible through the task sheet.

**Risks.**
- *The biggest single phase in the plan.* If it slips, Phases 1–3 have already
  delivered the spec's must-have, which is the reason for that ordering.
- *Drag precision and touch.* Addressed by the split above; revisit before
  building, not after.
- *Arrow rendering* over a scrolling, zooming grid is fiddly. Budget real time
  for it, and consider rendering arrows only for the visible range.

---

## 7. Phase 5 — people & trades

**Goal.** Real people, with contact details, day rates and — the operationally
important part — **certification expiry dates that the app warns about**. Tasks
get an assignee. A completed stage can be signed off, and the app records who
signed and when.

### Migration `0020_people.sql`

**`contacts`** — a new table, not an extension of `suppliers`. This is
deliberate and follows the existing rule (`about.md` §6.6.1): *a worker is not a
supplier*. Putting Dave Builder into `suppliers` would put him on the Suppliers
screen as a merchant with an account, and start matching invoices against his
name.

| Column | Type |
|---|---|
| `id`, `user_id` | uuid |
| `name` | text not null |
| `company` | text |
| `trades` | text[] — a person does more than one |
| `phone`, `email`, `address` | text |
| `day_rate`, `hourly_rate` | numeric(10,2) |
| `supplier_id` | uuid → `suppliers(id)` on delete set null — the optional bridge for a subcontractor who *also* invoices as a company |
| `status` | text — `active` \| `inactive` |
| `notes` | text |

**`contact_certifications`**

| Column | Type |
|---|---|
| `id`, `user_id`, `contact_id` | uuid |
| `kind` | text — `Public liability` \| `Employers liability` \| `Gas Safe` \| `NICEIC` \| `Part P` \| `CSCS` \| `Other` (CHECK) |
| `reference` | text |
| `issued_on`, `expires_on` | date |
| `document_id` | uuid → `documents(id)` on delete set null — **Phase 6**; nullable until then |
| `notes` | text |

**`tasks.assignee_contact_id`** — the column reserved in `0016`, now given its
FK.

**`task_signoffs`**

| Column | Type |
|---|---|
| `id`, `user_id`, `project_id`, `task_id` | uuid |
| `signed_by` | uuid → `auth.users(id)` on delete set null |
| `signed_at` | timestamptz not null default now() |
| `outcome` | text — `approved` \| `rejected` \| `approved_with_snags` (CHECK) |
| `note` | text |

Per decision 3: **anyone signed in can sign; the app records who.** No role
check. `about.md` §9.1 must say so explicitly when this ships, because a
sign-off flow implies an authorisation model that does not exist, and someone
will assume it does.

> **A dependency that becomes real here.** The spec's example — *"plasterer
> can't start until first fix is signed off"* — means a `FS` dependency should
> optionally require the predecessor's sign-off, not just its finish date.
> Add `task_dependencies.requires_signoff boolean not null default false` in
> this migration. `scheduleProject` then reports the successor as **Blocked**
> rather than Ready when the predecessor is complete but unsigned. This is
> small, and it is the difference between a schedule and a process.

### Code

- `lib/data.ts` — `getContacts()`, `getContactBundle(id)`, cross-project like
  suppliers and items.
- `lib/certifications.ts` — `expiryStatus(cert, today)` → `valid` |
  `expiring_soon` (≤30 days) | `expired`. Derived, never stored.
- `app/api/contacts/…` — CRUD; `app/api/contacts/[id]/certifications/…`.
- **The Directory gains a third half.** `components/directory/Directory.tsx`
  currently pivots Suppliers ⇄ Items; it becomes Suppliers ⇄ Items ⇄ **People**,
  and `/contacts` renders it on the People segment — the same pattern
  `/suppliers` and `/items` already follow.
- `app/(app)/contacts/[id]/page.tsx` — one person: details, rates,
  certifications with expiry chips, assigned tasks, labour paid to them.
- `components/forms/ContactForm.tsx`, `components/forms/CertificationForm.tsx`.
- **An expiry warning where it will actually be seen** — on the Dashboard, in
  the amber-note style the Overview price alerts already use: *"2 certificates
  expire within 30 days"*. A compliance date buried on a detail page is a
  compliance date nobody reads.
- `LabourForm.tsx` gains an optional contact picker that prefills the rate.
  **The existing behaviour is preserved**: the name still goes on
  `purchase_lines.description_raw`, no supplier row is created. Choosing a
  contact fills the name and rate; typing a name freehand still works exactly as
  today.

**Done when.** Dave Builder exists once, with a phone number, a £220 day rate
and public liability expiring 14 Oct; the dashboard warns 30 days before; he is
the assignee on four tasks; and Phase 4's cost-impact chip uses his real rate
instead of a trade default.

---

## 8. Phase 6 — documents & photos

**Goal.** Planning permission, building control, warranties and certificates
live in one place, with issue and expiry dates, and drawings have versions where
it is always obvious which is current. Site photos form a timeline tied to a
phase, dated and location-tagged.

### Migration `0021_documents.sql`

**`documents`**

| Column | Type | Note |
|---|---|---|
| `id`, `user_id`, `project_id` | uuid | `project_id` **nullable** — a company insurance certificate is not a project's |
| `doc_type` | text CHECK | `planning` \| `building_control` \| `warranty` \| `certificate` \| `drawing` \| `spec` \| `contract` \| `photo` \| `other` |
| `title` | text not null | |
| `storage_path` | text not null | in a **new private `documents` bucket** — not `receipts`, which is invoice attachments with a different lifecycle |
| `mime_type`, `size_bytes` | text / bigint | |
| `issued_on`, `expires_on` | date | |
| `reference` | text | planning ref, certificate number |
| `phase_id`, `task_id` | uuid | on delete set null — what the photo timeline hangs off |
| `taken_at` | date | **capture** date, distinct from upload date — a photo's real timeline position |
| `location_room` | text | the spec's "location-tagged", reusing the existing vocabulary from `expense_entries.location_room` |
| `version_no` | integer not null default 1 | |
| `supersedes_id` | uuid → `documents(id)` on delete set null | the version chain |
| `is_current` | boolean not null default true | see below |
| `contact_id` | uuid → `contacts(id)` | so a certificate belongs to a person |
| `notes` | text | |

> **`is_current` is the one place this plan stores something derivable, and it
> is on purpose.** It could be computed as "nothing supersedes me", but the
> whole point of the requirement is that the answer must be *unambiguous at a
> glance and correct even if the chain is edited by hand*. It is maintained by a
> trigger — inserting a version with `supersedes_id = X` sets X's `is_current`
> to false in the same statement — so it cannot drift. `about.md` should record
> this exception and its reasoning, or a future reader will think it a mistake.

Storage: a new private bucket `documents`, with the same three
`storage.objects` policies as `receipts`, namespaced `{project_id}/…` (not by
user — this is a shared workspace).

### Code

- `lib/documents.ts` — `versionChain(doc, all)`, `expiryStatus` (shared with
  `lib/certifications.ts` — one function, not two).
- `app/api/documents/upload-url/`, `/[id]/`, `/[id]/version/` — signed-URL
  upload, reusing the pattern `app/api/invoices/upload-url/route.ts` established
  (direct-to-storage `PUT`, because of the 4.5MB Next.js body cap).
- A sixth project tab, **Files**, or — better — a section on Overview plus a
  `/projects/[id]/documents` route. **Recommendation: a route, not a tab.** Five
  tabs is already one more than the 2026-08-28 collapse settled on, and
  documents are browsed occasionally, not monitored.
- `components/documents/DocumentList.tsx`, `DocumentUpload.tsx`,
  `VersionHistory.tsx`.
- `components/documents/PhotoTimeline.tsx` — photos ordered by `taken_at`,
  grouped by phase, filterable by room. This is the spec's §1 photo timeline and
  it is mostly a query plus a grid.

**Done when.** The planning decision notice, the gas certificate and drawing
rev C are all findable in under five seconds; rev B is visibly superseded; and
the photo timeline shows the back bedroom from bare joists to plastered, in
order.

---

## 9. Phase 7 — communication

**Goal.** A dated log of what happened and what was decided, and a snagging list
with photos that moves open → fixed → verified.

### Migration `0022_activity_snags.sql`

**`activity_log`** — append-only by convention (no update route is built).

| Column | Type |
|---|---|
| `id`, `user_id`, `project_id` | uuid |
| `occurred_at` | timestamptz not null default now() |
| `kind` | text CHECK — `call` \| `site_visit` \| `decision` \| `email` \| `meeting` \| `note` |
| `summary` | text not null |
| `detail` | text |
| `contact_id`, `task_id`, `phase_id` | uuid, on delete set null |
| `created_by` | uuid → `auth.users(id)` |

**`snags`**

| Column | Type |
|---|---|
| `id`, `user_id`, `project_id` | uuid |
| `title` | text not null |
| `description` | text |
| `location_room` | text |
| `phase_id`, `task_id`, `contact_id` | uuid on delete set null — who is responsible for fixing it |
| `status` | text CHECK — `open` \| `fixed` \| `verified` \| `wont_fix` (exactly the spec's three, plus the one every real list needs) |
| `severity` | text CHECK — `minor` \| `major` \| `safety` |
| `raised_on`, `fixed_on`, `verified_on` | date |
| `verified_by` | uuid → `auth.users(id)` |

Snag photos are `documents` rows with `doc_type = 'photo'` and a
`snag_id` column added here — **not** a second file store. One document table.

### Code

- `app/api/projects/[id]/activity/`, `app/api/projects/[id]/snags/…`
- `components/project/ActivityLog.tsx` — a timeline, on the Overview tab or its
  own route; and `components/snags/SnagList.tsx` + `SnagForm.tsx`.
- A snag count in the project header, because an open safety snag should not
  need looking for.

**Done when.** A site visit on Tuesday, a decision about the kitchen worktop and
eleven snags with photos are all recorded, and the owner can filter to "open,
safety" in one tap.

---

## 10. Phase 8 — portfolio reporting

**Goal.** The spec's §6 dashboard: % complete, days behind/ahead and budget
variance, **across all live projects at once** — plus the rolled-up
multi-project Gantt from §7's practical extras.

### Migration

None. Everything is derived.

### Code

- `lib/portfolio.ts` — `projectHealth(bundle)` returning
  `{ pct_complete, days_variance, budget_variance, critical_risk }`, and
  `portfolioRollup(projects)`.
  - **`pct_complete`** = duration-weighted mean of `tasks.progress_pct`
    (decision 5). Shown beside a *cost-based* figure (`cost / budget`) that is
    explicitly labelled as such. Two numbers, both named — never one number that
    silently means the wrong thing.
  - **`days_variance`** = current computed completion vs the **baseline**
    completion. Falls back to `projects.planned_end_date` when no baseline has
    been captured, and says which it used.
- `app/(app)/dashboard/page.tsx` — the existing project cards gain a progress
  bar and a schedule chip (`7 days behind`, red / amber / green). The **budget
  bar stays exactly as it is** — it is correct and the vocabulary is settled.
- `app/(app)/portfolio/page.tsx` — the cross-project Gantt: `Gantt.tsx` from
  Phase 4 fed a concatenated task list with a project band per project, one row
  per phase when collapsed. Nav gains a fifth destination, or Dashboard gains a
  segmented control — **prefer the segmented control**; the 2026-08-28 rewrite
  went from six nav items to four on purpose.

**Done when.** One screen answers "which of my sites is behind, and by how
much, and is it costing me" without opening any of them.

---

## 11. Phase 9 — practical extras

**Goal.** Test a delay before committing it; flag the trades that weather and
lead times actually bite.

### Migration

None — `weather_sensitive` and `lead_time_days` were added in `0016`.

### Code

- **"What if" simulation.** This is nearly free by construction: `applyShift`
  and `scheduleProject` are pure and never write (Phase 3). A **Scenario mode**
  toggle on the Gantt holds a draft bundle in React state, renders it with a
  distinct visual treatment, shows the delta panel (*completion +9 days, cost
  +£2,140, 3 tasks newly critical*), and offers **Apply** or **Discard**.
  Apply reuses the existing `POST …/schedule/shift` per changed task. **Nothing
  new is written to the database for a scenario** — a saved scenario is a
  different, larger feature and is explicitly out of scope here.
- **Lead-time flags.** A task with `lead_time_days` shows an "order by" marker
  on the Gantt at `planned_start − lead_time_days`, and the dashboard lists
  anything whose order-by date is inside the next 14 days. This is a genuinely
  useful, tiny feature: it is how joinery and windows slip.
- **Weather flags, manual.** A `weather_sensitive` task shows an icon; the
  schedule view can filter to them. That is the whole of it.
- **Weather, live (optional, separable).** If wanted later: the site postcode on
  the project, a free forecast API, a daily cron (the codebase already runs
  crons via cron-job.org — see commit `71d84f2`) writing a small
  `weather_forecast` cache, and an amber chip on weather-sensitive tasks
  starting in the next 7 days. **Recommend deferring** until the manual flag has
  been used for a season and its value is known.

---

## 12. Track B — money and admin, independent of everything

These three depend on nothing in Track A and can be built first. Two of them are
the cheapest real value in the whole plan.

### B1 — Retention tracking (`0023_retention.sql`) — *small*

The spec's §3 item, and the cheapest unbuilt money feature.

| Table | Column | Note |
|---|---|---|
| `purchases` | `retention_pct numeric(5,2) check (between 0 and 100)` | nullable |
| `purchases` | `retention_release_due date` | nullable |
| `purchases` | `retention_released_on date` | nullable |

Derived in `lib/purchases.ts`, never stored:

- `retention_amount = round2(gross_total × retention_pct / 100)`
- `payable_now = gross_total − retention_amount`
- `balance` becomes `payable_now − paid` — **this changes an existing
  formula**, so it must be guarded: with `retention_pct` null (every existing
  row), the arithmetic is identical and no figure moves. Say so in `updates.md`
  with a before → after showing zero movement.
- A **Retention held** figure appears on the supplier statement and the Overview,
  separate from Owed. A retention is not an unpaid bill and must not read as one
   — that is the entire point of the feature.
- The dashboard lists retentions whose release date has passed.

### B2 — Contact details (part of Phase 5) — *small*

If Phase 5 is not being built soon, the four columns
(`phone`, `email`, `address`, `day_rate`) can go straight onto `suppliers` as an
interim, with the `contacts` table still arriving later. **Only do this if
Phase 5 is genuinely months away** — otherwise it is a migration that has to be
partly undone.

### B3 — Purchase orders (`0024_purchase_orders.sql`) — *medium*

The genuinely missing half of the spec's §3 first bullet: the app records
documents *received*, never orders *raised*.

**`purchase_orders`** — supplier, project, `po_number`, `raised_on`,
`expected_delivery`, `status` (`draft` \| `sent` \| `part_received` \|
`received` \| `cancelled`), `notes`, `task_id` (Phase 2's link).
**`purchase_order_lines`** — item, description, `qty_ordered`,
`qty_received`, `unit`, `unit_price`, `vat_rate`.
Plus `purchases.purchase_order_id` — how an arriving invoice is matched back to
what was ordered, which is where over-delivery and price-creep get caught.

> **Note for whoever builds this:** `purchase_lines.vat_rate` still carries
> `check (vat_rate in (0,20))` from `0008`, while `expense_entries.vat_rate` was
> widened to `(0,5,20)` by `0011`. Any new money table should use the **0/5/20**
> set, and it is worth fixing the `purchase_lines` CHECK in the same migration —
> a 5% invoice line is ordinary on residential work and `0011` exists precisely
> because one silently saved as zero-rated.

### B4 — Change orders / variations (`0025_variations.sql`) — *medium; needs Phase 1*

**`variations`** — project, `ref`, `title`, `description` (what changed and
why), `requested_by`, `raised_on`, `status` (`proposed` \| `approved` \|
`rejected` \| `withdrawn`), `approved_on`, `approved_by`, `cost_impact`
(numeric, signed — a variation can be an omission), `days_impact` (integer,
signed), `task_id` / `phase_id`.

It is a small table whose value is entirely in being linked: a variation should
show its cost against the tasks it touched and its days against the schedule
drift they caused. That is why it sits after Phase 1 even though it is a money
feature.

---

## 13. What this does to `about.md`

`about.md` is the reference and it is currently accurate. This plan roughly
doubles the application, so it needs new sections rather than edits scattered
through the existing ones. Proposed structure, to be added as the phases land:

| New section | Covers |
|---|---|
| §15 The schedule model | phases, tasks, dependencies, the **duration-is-authoritative** rule, cycles are guarded in TS not SQL |
| §16 The scheduling engine | forward/backward pass, float, critical path, the working calendar, auto-shift and the preview-then-confirm rule |
| §17 Cost tied to schedule | the line-level `task_id` rule, the ex-VAT budget basis, the untagged bucket |
| §18 People, certifications and sign-off | contacts are not suppliers; sign-off records who, and enforces nothing |
| §19 Documents | the second bucket, the version chain, why `is_current` is stored |
| §20 Portfolio reporting | the two % complete figures and why there are two |

And these existing sections need amending, not appending:

- **§2 "Five rules that will bite you"** — becomes six or seven. At minimum:
  *"a task's dates are derived from its duration and its dependencies; setting
  a date directly is an anchor, not a fact"*, and *"a task's budget is ex-VAT"*.
- **§4** — the table inventory grows from 12 to ~24. It needs a summary table at
  the top saying which group each belongs to, or it becomes unreadable.
- **§9.1** — must state that sign-off records identity but enforces nothing,
  because the feature's name implies otherwise.
- **§13 Current figures** — already flagged as historical. When Phase 2 lands
  there will be a real baseline again (budget vs cost per task); replace §13
  then, as it says to.

---

## 14. Estimating

No dates, because velocity here is unknown. Relative sizes only, where
**S** ≈ a session, **M** ≈ a few, **L** ≈ a substantial piece of work, **XL** ≈
the largest thing in the plan.

| Phase | Size | Note |
|---|---|---|
| B1 Retention | **S** | touches one derived formula; guard it |
| 5a Contact details only | **S** | four columns, four fields |
| 1 Schedule core | **L** | six tables, a tab, two forms — mostly breadth, little difficulty |
| 2 Cost ⇄ schedule | **M** | three columns and one new lib file; the value density is the highest in the plan |
| 3 Scheduling engine | **L** | the only genuinely intricate maths. **Write the tests.** |
| 4 Gantt v1 | **XL** | the biggest single item; deliberately after the value has landed |
| 5 People & sign-off | **M** | |
| 6 Documents & photos | **M** | second storage bucket, version chain trigger |
| 7 Communication | **M** | two straightforward tables |
| 8 Portfolio reporting | **M** | pure derivation over Phases 1–4 |
| 9 Practical extras | **S–M** | "what if" is nearly free if Phase 3 stayed pure |
| B3 Purchase orders | **M** | |
| B4 Variations | **M** | |

**The critical warning about ordering:** Phase 4 is the phase most likely to be
asked for first, because it is the one you can see. It is also the one that
delivers least on its own — a chart of tasks with no costs tagged to them is a
prettier version of a list. Phases 1–3 are what make it worth drawing, and
Phase 2 is what answers the spec's own Priority Note. Build in the order given.

---

## 15. Risks across the whole plan

1. **No test suite.** The app has none by design, and `npm run build` is the
   verification step. That is defensible for CRUD and derived totals; it is not
   defensible for a critical-path algorithm. `lib/schedule.test.mts` is a
   requirement of Phase 3, using the `node --test` runner already wired into
   `package.json`.
2. **Hand-run migrations.** Ten or more new migration files, each pasted into
   the SQL editor in order. Every phase must state plainly whether its migration
   has been run — this is already the house rule and it matters more as the
   count grows.
3. **Doubling the schema.** 12 tables become ~24. Every new one needs its
   `shared workspace` policy and its `authenticated` grant, or it silently
   returns nothing. This is `about.md` §2 rule 3 and it will bite at least once.
4. **The untagged-cost blind spot** (Phase 2). Called out in that phase because
   it is how this feature quietly produces a comforting, wrong answer.
5. **Cost-impact estimates being believed.** Phase 4's chip must show its
   working and refuse to guess. A number that gets quoted at a client and turns
   out to be invented is worse than an empty state.
6. **Sign-off implying permissions it does not have.** Documented in `about.md`
   §9.1 when Phase 5 ships, and worth saying on the screen itself.
7. **Scope.** This plan is a second application (scheduling) joined to the
   existing one (cost tracking) by a single nullable `task_id`. It is
   deliberately built so that stopping after any phase leaves something
   coherent — and so that stopping after Phase 2 already delivers the thing the
   spec says matters most.

---

## 16. What happens next

Nothing, until the owner has read §1 and either accepted the six assumptions or
corrected them. Three of them — **is `week_number` kept**, **is this really
multi-project**, and **does sign-off need real roles** — change the shape of the
work rather than its detail, and all three are cheaper to answer now than after
Phase 1.

After that, the recommended first move is **B1 (retention)** or **Phase 1
(schedule core)**, depending on whether the owner wants a small correct thing
this week or the foundation for everything else.
