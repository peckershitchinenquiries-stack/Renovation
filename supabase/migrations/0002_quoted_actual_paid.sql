-- RenovaTrack — re-model to the real spend tracker (Quoted / Actual / Paid).
-- Run in the Supabase SQL editor AFTER 0001_init.sql.
-- Safe to run on an empty database: the dropped columns held no real data.

-- ============================================================
-- projects: drop fields the user doesn't track
--   (address, project-level start/end dates, upfront contingency %)
-- ============================================================
alter table public.projects drop column if exists address;
alter table public.projects drop column if exists start_date;
alter table public.projects drop column if exists end_date;
alter table public.projects drop column if exists contingency_pct;

-- ============================================================
-- expense_entries: switch to Quoted / Actual / Paid amounts.
--   Keep qty + unit_cost (needed for price-over-time tracking),
--   vat_rate, and paid_date (= "Date Paid").
-- ============================================================
alter table public.expense_entries
  add column if not exists quoted_amount numeric(12,2) not null default 0
    check (quoted_amount >= 0);
alter table public.expense_entries
  add column if not exists actual_amount numeric(12,2) not null default 0
    check (actual_amount >= 0);
alter table public.expense_entries
  add column if not exists paid_amount numeric(12,2) not null default 0
    check (paid_amount >= 0);

alter table public.expense_entries drop column if exists hours;
alter table public.expense_entries drop column if exists labour_rate;
alter table public.expense_entries drop column if exists direct_labour_cost;

-- Index for fast "have I bought this item before?" lookups (price tracking).
create index if not exists idx_expense_entries_item
  on public.expense_entries (project_id, lower(description));
