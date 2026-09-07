-- RenovaTrack — 0017: tie money to work (implementation plan, Phase 2).
--
-- ############################################################
-- ##  STATUS: RUN — 2026-09-03, by the owner, after 0016.   ##
-- ##  Left here for the record. Re-runnable.                ##
-- ############################################################
--
-- This is the spec's stated must-have, and it is three nullable columns.
--
-- Why so small
-- ------------
-- Everything else in Phase 2 — budget vs committed vs cost vs paid per task,
-- per phase and per project, the variance chips, the By-task pivot — is
-- DERIVED on read in lib/scheduleCosts.ts. Nothing is stored. So the schema
-- change is only the join that has never existed: a cost knows its supplier,
-- its trade and its project, but nothing that says "this is part of the
-- first-fix electrics".
--
-- Line level, not document level
-- ------------------------------
-- `purchase_lines.task_id` is the authoritative link. A task's actual cost is
-- the sum of the LINES tagged to it. Tagging whole documents as well would
-- create two places to sum from, and one of them would eventually
-- double-count. The invoice form's "apply to all lines" control writes this
-- same column on every line — convenience, not a second source of truth.
--
-- `expense_entries.task_id` is the hand-entered half. It is a flat row that is
-- its own line, so the same rule holds.
--
-- ON DELETE SET NULL, and why it must not be CASCADE
-- --------------------------------------------------
-- Deleting a task must NEVER delete money. An untagged cost is a reporting
-- gap that one screen already shows you (the untagged bucket); a deleted
-- invoice line is a lost record with no way back. `on delete cascade` here
-- would mean tidying up the schedule silently destroys the books.
--
-- Nothing is backfilled and nothing moves. Every existing row gets
-- `task_id = null`, every existing figure reads exactly the same afterwards,
-- and every new per-task total starts at zero until someone tags something.

begin;

-- Fail early and clearly if 0016 was skipped, rather than erroring on the
-- foreign key with a message about a relation nobody has heard of.
do $$
begin
  if to_regclass('public.tasks') is null then
    raise exception
      'public.tasks does not exist — run 0016_schedule_core.sql first.';
  end if;
end $$;

-- ============================================================
-- 1. The link
-- ============================================================
alter table public.purchase_lines
  add column if not exists task_id uuid
    references public.tasks(id) on delete set null;

alter table public.expense_entries
  add column if not exists task_id uuid
    references public.tasks(id) on delete set null;

-- Partial indexes: the overwhelming majority of rows are untagged, and the
-- only question ever asked of this column is "which lines belong to task X".
create index if not exists idx_purchase_lines_task
  on public.purchase_lines (task_id) where task_id is not null;

create index if not exists idx_expense_entries_task
  on public.expense_entries (task_id) where task_id is not null;

-- ============================================================
-- 2. Nothing to grant, nothing to police
-- ============================================================
-- Both tables already carry the `shared workspace` policy from 0015 and their
-- grants from 0008/0014. A column added to an existing table inherits both —
-- there is no per-column RLS here to update.

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Two rows, both `task_id`, both nullable, both uuid — and a
-- count of how many lines are tagged, which is 0 immediately after
-- this runs and is the number the "untagged" figure on screen is
-- built from.
-- ------------------------------------------------------------------
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name = 'task_id'
  and table_name in ('purchase_lines','expense_entries')
order by table_name;

select
  (select count(*) from public.purchase_lines   where task_id is not null) as tagged_lines,
  (select count(*) from public.purchase_lines)                             as total_lines,
  (select count(*) from public.expense_entries  where task_id is not null) as tagged_entries,
  (select count(*) from public.expense_entries)                            as total_entries;
