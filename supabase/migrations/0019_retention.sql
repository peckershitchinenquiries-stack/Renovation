-- RenovaTrack — 0019: retention held back from a contractor
-- (implementation plan, Track B / B1).
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it there, in filename order, AFTER     ##
-- ##  0018. Re-runnable: `add column if not exists` only,   ##
-- ##  and no row is read, changed or deleted.               ##
-- ############################################################
--
-- Why
-- ---
-- Retention is money you agree to owe and deliberately do not pay yet — a
-- percentage held back from a contractor until the defects period is up. The
-- app has never had the concept, so the only way to record one was to leave an
-- invoice permanently part-paid. That put the retention in **Owed**, where it
-- sat next to genuinely overdue bills and was indistinguishable from one.
--
-- Separating the two IS the feature. A retention is not an unpaid bill: it is
-- not late, nobody is chasing it, and it has a date on which it becomes
-- payable. After this migration the app can say so.
--
-- What this does to the existing arithmetic — read this before running
-- ---------------------------------------------------------------------
-- It changes one derived formula, in lib/purchases.ts:
--
--     before:  balance = gross_total − paid
--     after:   balance = (gross_total − retention_amount) − paid
--
-- `retention_amount` is derived (gross × pct ÷ 100) and is **never stored** —
-- the same rule as every other total in this codebase (about.md §2).
--
-- Every existing row has `retention_pct` null, which makes `retention_amount`
-- zero and the two formulas identical to the penny. **No figure anywhere in
-- the app moves when this migration is run.** A figure only moves once
-- somebody types a percentage onto an invoice, which is exactly when they mean
-- it to.
--
-- Three columns and no new table, deliberately: a retention is an attribute of
-- one document — this invoice, 5% held, released on that date — not an entity
-- with a life of its own. A `retentions` table would need a join to say
-- anything at all.

begin;

-- ============================================================
-- 1. purchases — the three retention columns
-- ============================================================
alter table public.purchases
  -- The percentage held back, as agreed. Null (not 0) means "no retention on
  -- this invoice", which is a different statement from "0% was held" and is
  -- what every existing row says.
  add column if not exists retention_pct numeric(5,2),
  -- When it becomes payable. The dashboard lists retentions whose date has
  -- passed — a retention nobody reclaims is just a discount you gave away.
  add column if not exists retention_release_due date,
  -- When it was actually released. Non-null means it is no longer held, and
  -- the money goes back into Owed where it belongs.
  add column if not exists retention_released_on date;

alter table public.purchases
  drop constraint if exists purchases_retention_pct_range;
alter table public.purchases
  add constraint purchases_retention_pct_range check (
    retention_pct is null or (retention_pct >= 0 and retention_pct <= 100)
  );

-- A release date without a percentage describes nothing. Rejecting it here
-- rather than tolerating it keeps "is there a retention on this invoice?" a
-- single-column question.
alter table public.purchases
  drop constraint if exists purchases_retention_dates_need_pct;
alter table public.purchases
  add constraint purchases_retention_dates_need_pct check (
    retention_pct is not null
    or (retention_release_due is null and retention_released_on is null)
  );

-- Released before it was due is ordinary (a contractor asks early and you
-- agree), so the two dates are deliberately NOT ordered against each other.

-- The dashboard's "retention due for release" list: held, and past its date.
create index if not exists idx_purchases_retention_due
  on public.purchases (retention_release_due)
  where retention_pct is not null and retention_released_on is null;

-- ============================================================
-- 2. RLS
-- ============================================================
-- Nothing to do. `purchases` already carries the `shared workspace` policy
-- from 0015 and adding a column does not change a policy. Stated rather than
-- silently omitted, because "every new thing needs its policy" is the rule
-- that bites in this project (about.md §2) and a reader should be able to see
-- that it was considered.

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Three new columns, and — the point of the whole file — a count of
-- rows whose figures changed, which must be ZERO.
-- ------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'purchases'
  and column_name in
    ('retention_pct','retention_release_due','retention_released_on')
order by column_name;

select count(*) as purchases_with_retention
from public.purchases
where retention_pct is not null;
