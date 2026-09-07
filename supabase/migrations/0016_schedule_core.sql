-- RenovaTrack — 0016: the schedule core (implementation plan, Phase 1).
--
-- ############################################################
-- ##  STATUS: RUN — 2026-09-03, by the owner, in the        ##
-- ##  Supabase SQL editor. Left here for the record.        ##
-- ##  Re-runnable: everything is `if not exists` / `drop     ##
-- ##  policy if exists`, and no data is deleted.             ##
-- ############################################################
--
-- Prerequisite: 0015 must already have been run. Every table below copies
-- 0015's `shared workspace` policy shape, and the assertion block at the foot
-- of this file refuses to commit if they did not take. If you are unsure
-- whether 0015 ran, check first:
--
--     select tablename, policyname, qual from pg_policies
--     where schemaname = 'public' order by tablename;
--
-- Why
-- ---
-- The app has always been a very good money tracker and had no concept of
-- *time* at all: no tasks, no phases, no dependencies, no planned dates, and
-- therefore nothing a Gantt chart or a critical path could be drawn from. This
-- file adds that half of the application. It touches nothing that exists apart
-- from putting two dropped columns back on `projects`; no figure anywhere in
-- the app moves as a result of running it.
--
-- The one rule to internalise
-- ---------------------------
-- `tasks.duration_days` is AUTHORITATIVE and the planned dates are derived
-- from it plus the dependency constraints — except for a task with no
-- predecessors, where `planned_start` is the anchor everything else hangs
-- off. That is what makes auto-shift (Phase 3) have a defined behaviour at
-- all. Setting a date directly on a task with predecessors is an anchor, not
-- a fact: the scheduler may move it.
--
-- What is deliberately NOT here
-- -----------------------------
--   * Phase actual dates. They are min/max over the phase's tasks — a
--     computed total, and this codebase never stores one (about.md §2).
--   * A cycle constraint on task_dependencies. Postgres cannot express "this
--     graph is acyclic" cheaply. It is enforced by detectCycle() in
--     lib/schedule.ts and refused by the API route with a 400 naming the
--     loop. The database is NOT guarding it — do not assume otherwise.
--   * tasks.assignee_contact_id. The column is created here so Phase 1 code
--     can carry it, but `contacts` does not exist yet, so it gets its foreign
--     key in Phase 5 (0020_people.sql), not now.

begin;

-- ============================================================
-- 1. projects — the calendar anchor comes back
-- ============================================================
-- Both of these were in 0001 and dropped by 0002 because the owner did not
-- track them. They return because target-vs-actual dates are the whole point
-- of a schedule. `address`, `end_date` and `contingency_pct` stay dropped.
--
--   start_date       — the anchor `week_number` is measured from, so "week 7"
--                      can finally be shown as a real date range. Nullable: an
--                      unanchored project simply shows no week dates, exactly
--                      as it does today.
--   planned_end_date — the target completion, used for "days behind/ahead"
--                      when no baseline has been captured yet.
alter table public.projects
  add column if not exists start_date date,
  add column if not exists planned_end_date date;

-- ============================================================
-- 2. project_phases — demo / first fix / second fix / snagging
-- ============================================================
-- Editable, not hard-coded: the spec names those four as examples and every
-- job has its own list.
create table if not exists public.project_phases (
  id           uuid primary key default gen_random_uuid(),
  -- Provenance, not permission (0015). Every insert still stamps it.
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  sort_order   integer not null default 0,
  -- One of a fixed set, for the Gantt band. Nullable = "pick one for me".
  colour       text check (colour is null or colour in
                 ('slate','emerald','amber','blue','violet','rose','teal','orange')),
  -- The phase's own target, independent of the tasks inside it. Its ACTUAL
  -- dates are derived from its tasks and are never stored.
  target_start date,
  target_end   date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A phase that ends before it starts is a typo, not a plan.
  constraint project_phases_dates_ordered
    check (target_start is null or target_end is null or target_end >= target_start)
);

create index if not exists idx_project_phases_project
  on public.project_phases (project_id, sort_order);

-- ============================================================
-- 3. tasks — the unit of work, and the thing a cost gets tagged to
-- ============================================================
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  -- SET NULL, not cascade: deleting a phase must not destroy its work. An
  -- unphased task shows in an "Unphased" group, which is recoverable; a
  -- deleted one is not.
  phase_id      uuid references public.project_phases(id) on delete set null,
  name          text not null check (btrim(name) <> ''),
  -- Free text, matched against trade_lookups.name by convention only — NO
  -- foreign key, exactly like purchases.trade and expense_entries.trade
  -- (about.md §4.2/§4.6). Renaming a trade lookup does not rewrite history.
  trade         text,
  -- Reserved for Phase 5 (0020_people.sql), which adds the FK to `contacts`.
  -- Created now so Phase 1's types and API can carry it without a second
  -- migration to every read path.
  assignee_contact_id uuid,
  -- Nullable while a task is being sketched out. See the authority rule in
  -- the header: with predecessors, these are outputs of the scheduler.
  planned_start date,
  planned_end   date,
  actual_start  date,
  actual_end    date,
  duration_days integer check (duration_days is null or duration_days > 0),
  -- Hand-entered, per decision 5 of the implementation plan. Deriving
  -- progress from spend reports 90% done the day a large material order
  -- lands; the cost-based figure is shown BESIDE this one, never instead.
  progress_pct  numeric(5,2) not null default 0
                  check (progress_pct >= 0 and progress_pct <= 100),
  -- Deliberately NOT the expense_entries vocabulary. A task is not a payment:
  -- 'Paid' is meaningless for a piece of work and 'In Progress' means
  -- something different on each. Keeping the two lists apart is what stops a
  -- future join from quietly treating them as one enum.
  status        text not null default 'Not started'
                  check (status in
                    ('Not started','In progress','Blocked','Complete','Cancelled')),
  -- EX-VAT, to match purchase_lines.line_net and expense_entries.actual_amount.
  -- This is the per-task budget — the thing the app has never had. Comparing
  -- it against an incl-VAT cost would repeat the 2026-08-06 double-VAT error
  -- in a new place, so every screen showing it must label the basis.
  budget_amount numeric(12,2) check (budget_amount is null or budget_amount >= 0),
  -- Phase 9 uses both. The columns cost nothing now and save a migration then.
  weather_sensitive boolean not null default false,
  lead_time_days    integer check (lead_time_days is null or lead_time_days >= 0),
  -- Phase 4's cost-impact chip: a time-based hire (scaffold is the spec's own
  -- example) contributes rate × extra days when a task is dragged out.
  hire_daily_rate numeric(10,2) check (hire_daily_rate is null or hire_daily_rate >= 0),
  notes         text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tasks_planned_dates_ordered
    check (planned_start is null or planned_end is null or planned_end >= planned_start),
  constraint tasks_actual_dates_ordered
    check (actual_start is null or actual_end is null or actual_end >= actual_start)
);

create index if not exists idx_tasks_project on public.tasks (project_id, sort_order);
create index if not exists idx_tasks_phase   on public.tasks (phase_id);
create index if not exists idx_tasks_dates   on public.tasks (project_id, planned_start);

-- ============================================================
-- 4. task_dependencies — "the plasterer follows the first fix"
-- ============================================================
-- The spec names FS and SS. FF and SF are one CHECK value each and their
-- absence is more annoying than their presence.
--
--   FS  finish-to-start   successor starts after predecessor finishes
--   SS  start-to-start    successor starts after predecessor starts
--   FF  finish-to-finish  successor finishes after predecessor finishes
--   SF  start-to-finish   successor finishes after predecessor starts
create table if not exists public.task_dependencies (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  predecessor_id uuid not null references public.tasks(id) on delete cascade,
  successor_id   uuid not null references public.tasks(id) on delete cascade,
  dep_type       text not null default 'FS'
                   check (dep_type in ('FS','SS','FF','SF')),
  -- Negative is a lead ("start the plasterer two days before the first fix
  -- finishes"), which is ordinary on a renovation.
  lag_days       integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint task_dependencies_not_self check (predecessor_id <> successor_id)
);

create unique index if not exists ux_task_dependencies_pair
  on public.task_dependencies (predecessor_id, successor_id);
create index if not exists idx_task_dependencies_successor
  on public.task_dependencies (successor_id);
create index if not exists idx_task_dependencies_project
  on public.task_dependencies (project_id);

-- ============================================================
-- 5. task_baselines — what the plan said before it moved
-- ============================================================
-- Captured for a whole project at once by an explicit "Set baseline" action.
-- Never automatic, never silently overwritten: a baseline that re-captures
-- itself has nothing to drift from, which is the entire point of it.
--
-- The BUDGET is baselined too. "Budget drift" without a baselined budget is
-- just "the current budget", which drifts from nothing.
create table if not exists public.task_baselines (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  task_id       uuid not null references public.tasks(id) on delete cascade,
  -- So a re-baseline after a major variation is possible without losing the
  -- original.
  baseline_name text not null default 'Baseline 1' check (btrim(baseline_name) <> ''),
  planned_start date,
  planned_end   date,
  duration_days integer,
  budget_amount numeric(12,2),
  captured_at   timestamptz not null default now(),
  captured_by   uuid references auth.users(id) on delete set null
);

create unique index if not exists ux_task_baselines_task_name
  on public.task_baselines (task_id, baseline_name);
create index if not exists idx_task_baselines_project
  on public.task_baselines (project_id, baseline_name);

-- ============================================================
-- 6. task_revisions — why it moved, and whether anyone chose to
-- ============================================================
-- This is §7's change-tracking requirement and §1's variations log at task
-- level. Append-only by convention: no update or delete route is built.
--
-- `shift_source` is the column that makes the log worth reading. An
-- auto-shifted downstream task gets a row too, marked 'knock_on' and carrying
-- the originating task's reason — so six months later the log says "this
-- slipped because the steels were late", not "this slipped".
create table if not exists public.task_revisions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  task_id      uuid not null references public.tasks(id) on delete cascade,
  changed_at   timestamptz not null default now(),
  changed_by   uuid references auth.users(id) on delete set null,
  -- What moved. Kept as a plain text column rather than an enum: the set of
  -- fields worth logging will grow, and a CHECK here would mean a migration
  -- every time it does.
  field        text not null check (btrim(field) <> ''),
  -- Text on purpose. This is a log, not a calculation input — nothing reads
  -- these back as numbers or dates, and a date that was cleared has to be
  -- distinguishable from one that was never set.
  old_value    text,
  new_value    text,
  reason_code  text check (reason_code is null or reason_code in
                 ('material_delay','weather','client_change','trade_no_show',
                  'scope_change','other')),
  reason_note  text,
  shift_source text not null default 'manual'
                 check (shift_source in ('manual','knock_on'))
);

create index if not exists idx_task_revisions_task
  on public.task_revisions (task_id, changed_at desc);
create index if not exists idx_task_revisions_project
  on public.task_revisions (project_id, changed_at desc);

-- ============================================================
-- 7. updated_at triggers (reusing public.set_updated_at from 0001)
-- ============================================================
drop trigger if exists trg_project_phases_updated on public.project_phases;
create trigger trg_project_phases_updated before update on public.project_phases
  for each row execute function public.set_updated_at();

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- 8. RLS and grants — the 0015 shape, copied exactly
-- ============================================================
-- A new table with RLS enabled and NO policy returns nothing at all, and with
-- RLS left disabled leaks everything to `anon`. Both failure modes are silent.
-- `to authenticated` is the load-bearing part: it is the only thing stopping a
-- signed-out browser reading the schedule.
--
-- The grant matters separately from the policy: a missing grant is a hard
-- 42501 `permission denied`, not an empty result (0014).
do $$
declare
  t text;
begin
  foreach t in array array[
    'project_phases', 'tasks', 'task_dependencies',
    'task_baselines', 'task_revisions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "shared workspace" on public.%I', t);
    execute format(
      'create policy "shared workspace" on public.%I '
      'for all to authenticated using (true) with check (true)', t);
    execute format('grant all privileges on public.%I to authenticated', t);
    -- 0014 set default privileges for service_role on future tables, but say
    -- it explicitly rather than trusting that it covered this session.
    execute format('grant all privileges on public.%I to service_role', t);
  end loop;
end $$;

-- ============================================================
-- 9. Assert the policies actually took
-- ============================================================
-- Same reasoning as 0015 §5: a wrong policy here does not error, it returns an
-- empty Schedule tab, which is indistinguishable from "no tasks yet".
do $$
declare
  t text;
  missing text[] := '{}';
begin
  foreach t in array array[
    'project_phases', 'tasks', 'task_dependencies',
    'task_baselines', 'task_revisions'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename  = t
        and policyname = 'shared workspace'
        and qual       = 'true'
    ) then
      missing := missing || t;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'Schedule tables not shared: % — nothing committed.',
      array_to_string(missing, ', ');
  end if;

  raise notice 'Schedule core ready: 5 tables, all shared across signed-in users.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Five rows, each "shared workspace" with qual = true, and the
-- two columns back on `projects`.
-- ------------------------------------------------------------------
select tablename, policyname, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('project_phases','tasks','task_dependencies',
                    'task_baselines','task_revisions')
order by tablename;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('start_date','planned_end_date')
order by column_name;
