# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## MANDATORY — read first, write last

**Before making any change: read [`about.md`](./about.md).** It is the full
reference for this project — every table, every field, and exactly how each
number on each screen is calculated, with file and line references. It also
lists the known traps that have already caused bugs. Do not re-derive this from
the code; read it. Then skim the last few entries in `updates.md` for recent
context.

**After making any change: add an entry to [`updates.md`](./updates.md).**
This is required for *every* change — schema, code, data, docs, however small.
Use the template at the top of that file. An entry must state, in plain English:

- what changed and why
- where the information came from (which spreadsheet + sheet, table, or screen)
- **files used** (read) and **files changed** (modified), by path
- whether a migration was written *and whether it has actually been run*
- any headline figure that moved, as `before → after`

Write it so a non-developer can follow it a year from now. Example of the right
level of detail: *"today we changed 20 rows from Planned to Paid, using the
Paid Date column of the Week-by-Week Plan sheet in
46_Glenferrie_Rd_..._Template.xlsx; changed build_import_sql.py and added
migration 0006."*

**If `about.md` becomes wrong because of your change, update `about.md` too.**
Keep its §13 figures current.

## Project

RenovaTrack — a renovation project cost tracker for 46 Glenferrie Road. Next.js 14
(App Router) · TypeScript · Tailwind · Supabase. Single-user in practice
(`admin@pk.com`); public sign-up is disabled, users are created in the Supabase
dashboard.

## Commands

```bash
npm run dev     # dev server on :3000
npm run build   # production build — also the only full typecheck
npm run lint    # next lint
```

There is no test suite. `npm run build` is the closest thing to a verification
step, since it typechecks the whole project; run it after non-trivial changes.

Migrations are **not** applied by a CLI. Each file in `supabase/migrations/` is
pasted into the Supabase SQL editor and run by hand, in filename order.

## Architecture

### Data flows two different ways — know which you're in

1. **Server Components read Supabase directly.** `lib/data.ts` (`getProjectBundle`)
   fetches project + entries + lookups + weeks in one pass for the project detail
   page. Pages under `app/(app)/` are async Server Components using
   `createClient()` from `lib/supabase/server.ts`.
2. **Client Components mutate through Route Handlers** in `app/api/`, via
   `apiFetch` from `lib/fetcher.ts`. Handlers call `requireUser()` from
   `lib/api.ts`, which returns either `{user, supabase}` or a 401 response —
   the caller must check for the `response` key and return it early.

### Queries never filter by user — RLS does it

No query anywhere includes `.eq("user_id", ...)`. Every table has an
`auth.uid() = user_id` policy, so scoping is entirely implicit. Two consequences
worth internalising:

- Adding a table means adding its RLS policy, or it returns nothing (or leaks
  everything, if RLS is left disabled).
- An empty result is ambiguous: no rows, or rows owned by a different user.
  See "Data recovery" below — this exact ambiguity caused a real incident.

### Totals are computed, never stored

`total_incl_vat` does not exist as a column. `computeEntry` in
`lib/calculations.ts` derives `subtotal`, `vat_amount`, `total_incl_vat`,
`materials_cost` and `remaining` on every read, turning `ExpenseEntry` into
`ExpenseEntryComputed`. Aggregations in `lib/summary.ts` all consume the
computed type. Never persist a derived total.

Amounts are entered as **Quoted / Actual / Paid** (migration 0002 replaced an
earlier hours × rate model). VAT is 0 or 20 only — enforced by a CHECK
constraint, so any other value fails at insert.

### `source` splits the app in two

`expense_entries.source` is `'diary'` or `'ledger'` (migration 0003):

- **`diary`** — the week-by-week plan. Powers the Expenses tab *and all Overview
  analytics*. `ProjectDetail.tsx` and `ExpensesTab.tsx` both filter
  `e.source !== "ledger"`.
- **`ledger`** — imported reference rows shown only in the Trades and
  Materials & Suppliers tabs.

No screen sums both. Summing them double-counts overlapping spend, so a raw
`sum(actual_amount)` across the table is not a meaningful project total. New
entries default to `diary`.

### Auth

`middleware.ts` runs `updateSession` on every non-static path to refresh the
Supabase session cookie. Route Handlers use the server client, never the browser
client. `createServiceClient()` (service-role key) exists only for storage MIME
validation and signed URLs — never expose it to the client.

## Schema constraints that bite

CHECK constraints reject invalid values at insert rather than coercing them.
When writing SQL or seed data, match these exactly (mirrored in `types/index.ts`):

- `category`: `Labour` | `Materials` | `Skip/Disposal` | `Other`
- `status`: `Planned` | `In Progress` | `Paid` | `Cancelled`
- `payment_method`: `Cash` | `Debit Card` | `Credit Card` | `Bank Transfer`
- `vat_rate`: `0` or `20`
- `paid_date` is a real `date` — the source spreadsheets contain free text like
  `Friday 27/2` that cannot be stored in it

## Data recovery

**Every `user_id` is `references auth.users(id) on delete cascade`.** Deleting an
auth user silently destroys all of that user's projects, expenses, weeks and
trade lookups. This has already happened once.

If the app shows no data:

1. Query counts in the SQL editor (which bypasses RLS). All zeros means the rows
   are gone, not hidden — RLS was a red herring.
2. Check `select id, email from auth.users`. A recreated account gets a **new**
   UUID; same email does not mean same user.
3. Rebuild from the spreadsheets in the repo root, which are the source of truth:
   set `USER_ID` at the top of `scripts/build_import_sql.py` to the current UUID,
   run `python3 scripts/build_import_sql.py`, then run the generated
   `supabase/migrations/0005_reimport_data.sql` in the SQL editor.

`0005` is re-runnable — it deletes the prior import of the project first.

## Changelog

**Moved to [`updates.md`](./updates.md).** Every change — schema, code, data or
docs — is recorded there, oldest first, using the template at the top of that
file. Adding an entry is mandatory; see "MANDATORY" at the top of this file.

For how the project actually works, see [`about.md`](./about.md).
