-- RenovaTrack — 0018: the working calendar (implementation plan, Phase 3).
--
-- ############################################################
-- ##  STATUS: RUN — 2026-09-03, by the owner, after 0017.   ##
-- ##  Left here for the record. Re-runnable.                ##
-- ############################################################
--
-- Why a scheduler needs this at all
-- ---------------------------------
-- A plasterer does not work Sunday. A scheduling engine that counts calendar
-- days instead of working days drifts by two days a week, every week, and
-- reports a completion date that is wrong by a fortnight after two months.
-- Five working days a week with a configurable list of non-working days is the
-- minimum that is not simply incorrect.
--
-- It is two real columns, not a blob in `projects.notes`. Structured data in a
-- free-text field is unqueryable, unvalidatable and eventually gets edited by
-- a human who does not know it is structured.
--
-- Everything that USES this is pure TypeScript in lib/schedule.ts —
-- workingDaysBetween, addWorkingDays, the forward and backward passes. This
-- file only stores which days count.

begin;

-- ============================================================
-- 1. projects.working_weekdays
-- ============================================================
-- ISO weekday numbers, the same convention Postgres `isodow` and JavaScript's
-- own arithmetic in lib/schedule.ts use:
--
--     1 = Monday … 5 = Friday, 6 = Saturday, 7 = Sunday
--
-- Default {1,2,3,4,5} — Monday to Friday. A job that genuinely runs Saturdays
-- sets {1,2,3,4,5,6}; the engine reads it and the bars get longer or shorter
-- accordingly. An empty array would mean "no day is a working day", which
-- would make every task infinitely long, so it is refused.
alter table public.projects
  add column if not exists working_weekdays smallint[] not null default '{1,2,3,4,5}';

alter table public.projects
  drop constraint if exists projects_working_weekdays_valid;
alter table public.projects
  add constraint projects_working_weekdays_valid check (
    array_length(working_weekdays, 1) between 1 and 7
    and working_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  );

-- ============================================================
-- 2. project_holidays — the days nobody is on site
-- ============================================================
-- Bank holidays, the Christmas shutdown, a week the owner is away. One row
-- per date per project rather than a shared national calendar: this is a
-- single-workspace app, the list is short, and "which days is MY site shut"
-- is the only question ever asked of it.
create table if not exists public.project_holidays (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  holiday_date date not null,
  name         text,
  created_at   timestamptz not null default now()
);

-- One row per date. Adding Christmas Day twice is a mistake, not two holidays.
create unique index if not exists ux_project_holidays_project_date
  on public.project_holidays (project_id, holiday_date);

-- ============================================================
-- 3. RLS and grants — the 0015 shape
-- ============================================================
alter table public.project_holidays enable row level security;
drop policy if exists "shared workspace" on public.project_holidays;
create policy "shared workspace" on public.project_holidays
  for all to authenticated using (true) with check (true);
grant all privileges on public.project_holidays to authenticated;
grant all privileges on public.project_holidays to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'project_holidays'
      and policyname = 'shared workspace'
      and qual       = 'true'
  ) then
    raise exception 'project_holidays is not shared — nothing committed.';
  end if;
  raise notice 'Working calendar ready.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Every project should now show {1,2,3,4,5}.
-- ------------------------------------------------------------------
select id, name, working_weekdays, start_date, planned_end_date
from public.projects
order by created_at;
