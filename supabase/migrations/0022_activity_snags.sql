-- RenovaTrack — 0022: the activity log and the snagging list
-- (implementation plan, Phase 7).
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it AFTER 0021. Re-runnable.            ##
-- ############################################################
--
-- Why
-- ---
-- There are `notes` fields on projects, expense entries, purchases, suppliers
-- and items — and no way at all to record something that is not attached to a
-- cost. "Rang the building inspector Tuesday, he wants the trench left open"
-- has nowhere to go, and by the time it matters nobody remembers whether the
-- call happened.
--
-- Two tables, and they are deliberately not one. An activity entry is a record
-- of something that HAPPENED and is finished. A snag is something that is
-- WRONG and has a state that changes until somebody fixes it and somebody else
-- agrees it is fixed. A single table with a nullable status would make every
-- snagging query filter out phone calls.

begin;

-- ============================================================
-- 1. activity_log — what happened, and what was decided
-- ============================================================
-- Append-only by convention: no update or delete route is built. The value of
-- a log is entirely in its being trustworthy, and a log that can be quietly
-- rewritten afterwards answers nothing.
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,

  -- WHEN IT HAPPENED, which is not when it was typed. A site visit recorded on
  -- Friday evening belongs on Tuesday. Defaulting to now() keeps the common
  -- case one field shorter.
  occurred_at timestamptz not null default now(),

  kind        text not null check (kind in
                ('call','site_visit','decision','email','meeting','note')),
  -- The one line that shows in the timeline. Everything else is optional.
  summary     text not null check (btrim(summary) <> ''),
  detail      text,

  -- What it was about. All SET NULL — deleting a task must not delete the
  -- record of the conversation about it.
  contact_id  uuid references public.contacts(id) on delete set null,
  task_id     uuid references public.tasks(id) on delete set null,
  phase_id    uuid references public.project_phases(id) on delete set null,

  -- SET NULL rather than cascade, for the same reason task_signoffs.signed_by
  -- is: the log must survive the account that wrote it.
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_activity_log_project
  on public.activity_log (project_id, occurred_at desc);
create index if not exists idx_activity_log_task on public.activity_log (task_id);
create index if not exists idx_activity_log_contact on public.activity_log (contact_id);

-- ============================================================
-- 2. snags — open → fixed → verified
-- ============================================================
-- The spec names three states. There are four: every real snagging list
-- eventually contains something that was looked at and deliberately left, and
-- without `wont_fix` that item stays open for ever and makes the open count
-- meaningless.
--
-- `severity` exists so "any open safety snags?" is a query rather than a read
-- of every title.
create table if not exists public.snags (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,

  title         text not null check (btrim(title) <> ''),
  description   text,
  location_room text,

  phase_id      uuid references public.project_phases(id) on delete set null,
  task_id       uuid references public.tasks(id) on delete set null,
  -- Who is responsible for putting it right. SET NULL: removing somebody from
  -- the register must not delete the snag.
  contact_id    uuid references public.contacts(id) on delete set null,

  status        text not null default 'open'
                  check (status in ('open','fixed','verified','wont_fix')),
  severity      text not null default 'minor'
                  check (severity in ('minor','major','safety')),

  raised_on     date not null default current_date,
  fixed_on      date,
  verified_on   date,
  verified_by   uuid references auth.users(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint snags_fix_before_verify
    check (fixed_on is null or verified_on is null or verified_on >= fixed_on)
);

create index if not exists idx_snags_project
  on public.snags (project_id, status, severity);
create index if not exists idx_snags_open
  on public.snags (project_id) where status = 'open';
create index if not exists idx_snags_task    on public.snags (task_id);
create index if not exists idx_snags_contact on public.snags (contact_id);

drop trigger if exists trg_snags_updated on public.snags;
create trigger trg_snags_updated before update on public.snags
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. documents.snag_id — snag photos are documents
-- ============================================================
-- NOT a second file store. A photo of a cracked tile is a document with
-- doc_type = 'photo' and a snag_id, and it therefore gets the same upload
-- route, the same bucket, the same signed-URL read and the same delete path as
-- every other file. Two file stores is two of everything, for ever.
alter table public.documents
  add column if not exists snag_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_snag_fk'
  ) then
    alter table public.documents
      add constraint documents_snag_fk
      foreign key (snag_id) references public.snags(id) on delete set null;
  end if;
end $$;

create index if not exists idx_documents_snag on public.documents (snag_id);

-- ============================================================
-- 4. RLS and grants — the 0015 shape
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['activity_log','snags']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "shared workspace" on public.%I', t);
    execute format(
      'create policy "shared workspace" on public.%I '
      'for all to authenticated using (true) with check (true)', t);
    execute format('grant all privileges on public.%I to authenticated', t);
    execute format('grant all privileges on public.%I to service_role', t);
  end loop;
end $$;

do $$
declare
  t text;
  missing text[] := '{}';
begin
  foreach t in array array['activity_log','snags']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = 'shared workspace' and qual = 'true'
    ) then
      missing := missing || t;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'Communication tables not shared: % — nothing committed.',
      array_to_string(missing, ', ');
  end if;

  raise notice 'Activity log and snagging ready: 2 tables, shared.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

select tablename, policyname, roles, qual
from pg_policies
where schemaname = 'public' and tablename in ('activity_log','snags')
order by tablename;
