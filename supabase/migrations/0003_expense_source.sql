-- RenovaTrack — separate the week-by-week diary from imported reference rows.
-- Run in the Supabase SQL editor AFTER 0002_quoted_actual_paid.sql.
--
-- 'diary'  = week-by-week Expenses entries (File 1 + anything added in-app).
--            New entries default to this, so nothing else needs to change.
-- 'ledger' = imported reference rows (File 2: Trades & Labour + Materials &
--            Suppliers). These show in the Trades and Materials & Suppliers
--            tabs but NOT in the week-by-week Expenses list.

alter table public.expense_entries
  add column if not exists source text not null default 'diary'
  check (source in ('diary', 'ledger'));

-- Backfill: mark the File 2 import (weeks 16+ on the 46_Glenferrie_Rd project)
-- as ledger rows. Adjust the project id if you re-run for another project.
update public.expense_entries
  set source = 'ledger'
  where project_id = '6b5dac2b-9132-4e6f-80c1-8fff8d68c098'
    and week_number >= 16;
