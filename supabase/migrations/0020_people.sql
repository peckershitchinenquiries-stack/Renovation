-- RenovaTrack — 0020: people, certifications and sign-off
-- (implementation plan, Phase 5).
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it AFTER 0019. Re-runnable.            ##
-- ############################################################
--
-- Why a new table and not four columns on `suppliers`
-- ---------------------------------------------------
-- Because **a worker is not a supplier** (about.md §6.6.1), and that is not a
-- style preference — it is how the money side of this app already behaves.
-- Labour is logged with the person's name on `purchase_lines.description_raw`
-- and NO supplier row is created, deliberately. Putting Dave Builder into
-- `suppliers` would put him on the Suppliers screen as a merchant with a trade
-- account, and would start matching invoices against his name.
--
-- So: `contacts` is the people register, `suppliers` stays the merchant
-- register, and `contacts.supplier_id` is the optional bridge for the one real
-- overlap — a subcontractor who also invoices as a limited company.
--
-- What this is actually for
-- -------------------------
-- The valuable half of this migration is not the phone numbers. It is
-- `contact_certifications.expires_on`: public liability that lapsed in March,
-- on a job that is still running, is a real problem that nobody notices
-- because nobody looks. The app can warn 30 days out, and after this it does.
--
-- Sign-off: what it does and does not mean
-- ----------------------------------------
-- `task_signoffs` records WHO signed and WHEN. It enforces nothing. This
-- workspace has no roles — since 0015, signing in is the entire authorisation
-- model and anyone signed in can edit or delete anything (about.md §9.1). A
-- sign-off flow implies a permission concept that does not exist here, and
-- somebody will assume it does, so it is written down in three places: here,
-- in about.md §9.1, and on the screen itself.
--
-- The record is the valuable part and it works without roles. Real roles mean
-- rewriting every RLS policy in the database and are a project of their own —
-- they should be their own decision, not a side effect of building this.

begin;

-- ============================================================
-- 1. contacts — the people register
-- ============================================================
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  -- Provenance, not permission (0015).
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  company     text,
  -- A person does more than one trade — a builder who also tiles. An array
  -- rather than a single column, and rather than a join table: the list is two
  -- or three strings, it is only ever read whole, and `trades` on a task is
  -- already free text matched by convention.
  trades      text[] not null default '{}',
  phone       text,
  email       text,
  address     text,
  -- Both, because both get quoted. The Gantt's cost-impact chip prefers the
  -- day rate and says which rate it used (about.md §18).
  day_rate    numeric(10,2) check (day_rate is null or day_rate >= 0),
  hourly_rate numeric(10,2) check (hourly_rate is null or hourly_rate >= 0),
  -- The optional bridge to the merchant register. SET NULL: deleting the
  -- company must not delete the person.
  supplier_id uuid references public.suppliers(id) on delete set null,
  status      text not null default 'active'
                check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_contacts_name     on public.contacts (name);
create index if not exists idx_contacts_status   on public.contacts (status);
create index if not exists idx_contacts_supplier on public.contacts (supplier_id);

-- ============================================================
-- 2. contact_certifications — the dates that actually matter
-- ============================================================
-- The `kind` list is a CHECK rather than free text because these are the
-- documents that get asked for by name, and "PL insurance" / "Public Liab." /
-- "public liability" spread across three rows answers no question. 'Other'
-- plus `reference` covers anything not listed.
create table if not exists public.contact_certifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  kind        text not null check (kind in (
                'Public liability','Employers liability','Gas Safe','NICEIC',
                'Part P','CSCS','Other')),
  reference   text,
  issued_on   date,
  expires_on  date,
  -- The scan of the certificate. Reserved here and given its foreign key to
  -- `documents` in 0021, exactly the way 0016 reserved
  -- `tasks.assignee_contact_id` for this file — so the types and the API can
  -- carry the column without a second migration to every read path.
  document_id uuid,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint contact_certifications_dates_ordered
    check (issued_on is null or expires_on is null or expires_on >= issued_on)
);

create index if not exists idx_contact_certifications_contact
  on public.contact_certifications (contact_id);
-- The dashboard warning reads this: everything expiring soonest, first.
create index if not exists idx_contact_certifications_expiry
  on public.contact_certifications (expires_on)
  where expires_on is not null;

-- ============================================================
-- 3. tasks.assignee_contact_id — the FK 0016 reserved
-- ============================================================
-- SET NULL: removing a person from the register must not delete their work.
-- Written as a guarded ALTER because the column already exists and adding the
-- same constraint twice is an error rather than a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_assignee_contact_fk'
  ) then
    alter table public.tasks
      add constraint tasks_assignee_contact_fk
      foreign key (assignee_contact_id)
      references public.contacts(id) on delete set null;
  end if;
end $$;

create index if not exists idx_tasks_assignee
  on public.tasks (assignee_contact_id)
  where assignee_contact_id is not null;

-- ============================================================
-- 4. task_signoffs — who said this stage was done
-- ============================================================
-- Append-only by convention: no update route is built. A sign-off that can be
-- edited afterwards is not a sign-off. Withdrawing one means recording a
-- second, later outcome, which is also what actually happens on site.
create table if not exists public.task_signoffs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  -- SET NULL, not cascade: deleting an account must not erase the fact that
  -- the work was signed off. The record survives the person leaving.
  signed_by  uuid references auth.users(id) on delete set null,
  signed_at  timestamptz not null default now(),
  outcome    text not null check (outcome in
               ('approved','rejected','approved_with_snags')),
  note       text
);

create index if not exists idx_task_signoffs_task
  on public.task_signoffs (task_id, signed_at desc);
create index if not exists idx_task_signoffs_project
  on public.task_signoffs (project_id, signed_at desc);

-- ============================================================
-- 5. task_dependencies.requires_signoff
-- ============================================================
-- The spec's own example is "the plasterer can't start until first fix is
-- **signed off**" — which is not the same constraint as "until first fix
-- finishes". A finished-but-unsigned predecessor leaves the successor Blocked
-- rather than Ready, and lib/schedule.ts reports it that way.
--
-- This is small, and it is the difference between a schedule and a process.
alter table public.task_dependencies
  add column if not exists requires_signoff boolean not null default false;

-- ============================================================
-- 6. updated_at triggers (public.set_updated_at, from 0001)
-- ============================================================
drop trigger if exists trg_contacts_updated on public.contacts;
create trigger trg_contacts_updated before update on public.contacts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_contact_certifications_updated
  on public.contact_certifications;
create trigger trg_contact_certifications_updated
  before update on public.contact_certifications
  for each row execute function public.set_updated_at();

-- ============================================================
-- 7. RLS and grants — the 0015 shape, copied exactly
-- ============================================================
-- A new table with RLS enabled and no policy returns nothing; with RLS
-- disabled it leaks everything to `anon`. Both failure modes are silent, and
-- `to authenticated` is the only thing stopping a signed-out browser reading
-- every subcontractor's phone number.
do $$
declare
  t text;
begin
  foreach t in array array['contacts','contact_certifications','task_signoffs']
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

-- ============================================================
-- 8. Assert the policies actually took
-- ============================================================
do $$
declare
  t text;
  missing text[] := '{}';
begin
  foreach t in array array['contacts','contact_certifications','task_signoffs']
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
      'People tables not shared: % — nothing committed.',
      array_to_string(missing, ', ');
  end if;

  raise notice 'People ready: 3 tables, shared. Sign-off RECORDS who signed and enforces nothing.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report.
-- ------------------------------------------------------------------
select tablename, policyname, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('contacts','contact_certifications','task_signoffs')
order by tablename;

select conname from pg_constraint where conname = 'tasks_assignee_contact_fk';
