-- RenovaTrack — 0024: change orders / variations
-- (implementation plan, Track B / B4).
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it AFTER 0023. Re-runnable.            ##
-- ############################################################
--
-- Why
-- ---
-- The spec's §1 asks for a variations log: what changed, why, and what it
-- cost. The app has `quoted_amount` and a variance against it — which is the
-- RESULT of variations — but no record of what was actually changed, when,
-- who asked for it, who agreed to it, or what it did to the programme.
--
-- On a renovation this is the row that gets argued about six months later, and
-- "the quote went up by £4,000 at some point" is not an answer.
--
-- One small table, and its value is entirely in being linked
-- ----------------------------------------------------------
-- `cost_impact` and `days_impact` are typed in, as agreed at the time — they
-- are the AGREEMENT, not a derivation. The actual money that followed lands on
-- `purchase_lines.task_id` like every other cost, and the actual slip shows in
-- `task_revisions`. Reading a variation next to the tasks it names is what
-- makes it worth having; a variations table with no `task_id` is a
-- spreadsheet with extra steps, which is why this sits after Phase 1 despite
-- being a money feature.
--
-- Both impacts are SIGNED. A variation can be an omission: taking the second
-- bathroom out of the scope is a variation worth −£6,000 and −5 days, and a
-- table that can only record additions quietly reports the job as more
-- expensive than it is.

begin;

-- ============================================================
-- 1. variations
-- ============================================================
create table if not exists public.variations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,

  -- The number it gets called by on site — "VO 7". Free text, unique per
  -- project when set, because two variations sharing a reference is the one
  -- thing that makes the log unusable.
  ref          text,
  title        text not null check (btrim(title) <> ''),
  -- What changed and WHY. The why is the entire point; a description that
  -- only says what changed is already in the drawings.
  description  text,

  -- Free text, not a contact FK: the person who asks for a change is very
  -- often the client, the architect or the building inspector — none of whom
  -- is in the trades register, and none of whom should be added to it just to
  -- be named here.
  requested_by text,
  raised_on    date not null default current_date,

  status       text not null default 'proposed'
                 check (status in ('proposed','approved','rejected','withdrawn')),
  approved_on  date,
  -- SET NULL: the approval must survive the account that gave it.
  approved_by  uuid references auth.users(id) on delete set null,

  -- Signed. Negative is an omission — see the header.
  cost_impact  numeric(12,2),
  days_impact  integer,

  -- What it touched. SET NULL both: deleting a task must not delete the
  -- record of the variation that created it.
  task_id      uuid references public.tasks(id) on delete set null,
  phase_id     uuid references public.project_phases(id) on delete set null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- An approval date on something that is not approved is a contradiction,
  -- and it is the kind that makes a report silently wrong rather than error.
  constraint variations_approved_needs_status check (
    approved_on is null or status = 'approved'
  )
);

create unique index if not exists ux_variations_ref
  on public.variations (project_id, ref) where ref is not null;
create index if not exists idx_variations_project
  on public.variations (project_id, status, raised_on desc);
create index if not exists idx_variations_task  on public.variations (task_id);
create index if not exists idx_variations_phase on public.variations (phase_id);

drop trigger if exists trg_variations_updated on public.variations;
create trigger trg_variations_updated before update on public.variations
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. RLS and grants — the 0015 shape
-- ============================================================
alter table public.variations enable row level security;
drop policy if exists "shared workspace" on public.variations;
create policy "shared workspace" on public.variations
  for all to authenticated using (true) with check (true);
grant all privileges on public.variations to authenticated;
grant all privileges on public.variations to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'variations'
      and policyname = 'shared workspace' and qual = 'true'
  ) then
    raise exception 'variations is not shared — nothing committed.';
  end if;
  raise notice 'Variations ready. Track B complete: 0019-0024.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

select tablename, policyname, roles, qual
from pg_policies where schemaname = 'public' and tablename = 'variations';
