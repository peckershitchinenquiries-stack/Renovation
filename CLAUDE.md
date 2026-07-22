# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Append an entry here for every change made to this project — schema, code, or
data. Newest at the bottom. Keep entries to one or two lines: what changed and
why.

### 2026-07-20 — Data loss and recovery
- Diagnosed empty app: the `admin@pk.com` auth user was deleted and recreated,
  and `on delete cascade` had wiped all rows. Confirmed 0 projects / 0 expenses /
  0 weeks; the 13 surviving trade lookups were fresh output of the
  `trg_seed_trades` trigger, not originals.
- Added `scripts/build_import_sql.py` — regenerates a full import from
  `46_Glenferrie_Rd_..._Template.xlsx` (week-by-week diary) and
  `Renovation_Cost_Tracker-1.xlsx` (trades + materials ledger).
- Added and ran `supabase/migrations/0005_reimport_data.sql`: restored 40 diary
  rows (weeks 1–15), 96 ledger rows, 16 trade lookups, under UUID
  `5d3fc9ff-92a3-4923-a18b-7eb5eade3105`. Ledger total £98,932.12 matches the
  Dashboard sheet.
- 20 free-text paid dates could not fit the `date` column; preserved in each
  row's `notes` as `Paid date (as written): ...`.
- Deleted `0004_reassign_orphaned_data.sql` — written against the wrong
  hypothesis (that rows survived with a stale `user_id`) and never applied.
- Known open risk: the `on delete cascade` FKs are unchanged, deliberately.

### 2026-07-22 — Dashboard card double-counted ledger rows
- `app/(app)/dashboard/page.tsx` summed every `expense_entries` row with no
  `source` filter, so each card showed diary + ledger (£43,686.17 + £98,932.12 =
  £142,618.29, i.e. 144% of a budget that is itself the ledger total) while the
  project Overview showed the correct £43,686.17 / 44%.
- Added `.filter((e) => e.source !== "ledger")`, matching `ProjectDetail.tsx:73`.
  Both views now use the same basis (`total_incl_vat`, excluding `Cancelled`).
