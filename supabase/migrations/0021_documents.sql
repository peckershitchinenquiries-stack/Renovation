-- RenovaTrack — 0021: the document and photo store
-- (implementation plan, Phase 6).
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it AFTER 0020. Re-runnable.            ##
-- ############################################################
--
-- Why
-- ---
-- The only file store this app has ever had is invoice attachments: the
-- `receipts` table, whose rows MUST hang off a purchase, and the `invoices`
-- bucket behind the upload flow. There has been nowhere to put a planning
-- decision notice, a gas certificate, a warranty, drawing rev C, or a
-- photograph of the back bedroom — because none of those is an invoice.
--
-- `receipts` and `invoices` stay exactly as they are. An invoice attachment is
-- a different thing with a different lifecycle: it is evidence for one money
-- row, it arrives through the extraction pipeline, and it is never versioned.
-- Mixing the two would mean every document query filtering out invoice scans.
--
-- The one deliberate exception to a rule this codebase otherwise never breaks
-- ---------------------------------------------------------------------------
-- `is_current` is DERIVABLE — it means "nothing supersedes me" — and this
-- codebase never stores a derived value (about.md §2). It is stored here on
-- purpose, and the reason is the requirement itself: the whole point of
-- drawing version control is that *which one is current* must be unambiguous
-- at a glance and correct even if somebody edits the chain by hand. Computing
-- it would make "current" an opinion of whichever query ran.
--
-- It cannot drift, because nothing maintains it by hand: the trigger below
-- clears the superseded row's flag in the same statement that creates the new
-- version. about.md §19 records this exception so a future reader does not
-- take it for a mistake.

begin;

-- ============================================================
-- 1. documents
-- ============================================================
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- NULLABLE, and that is the point: a company's public liability certificate
  -- belongs to the business, not to 46 Glenferrie Road. A project-less
  -- document shows in the Documents screen of every project's owner rather
  -- than being invisible because it had nowhere to live.
  project_id   uuid references public.projects(id) on delete cascade,

  doc_type     text not null check (doc_type in (
                 'planning','building_control','warranty','certificate',
                 'drawing','spec','contract','photo','other')),
  title        text not null check (btrim(title) <> ''),

  -- In the NEW private `documents` bucket created at the foot of this file —
  -- not `receipts` and not `invoices`.
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),

  -- A certificate that expired is worse than one you never had, because you
  -- believed you had it. Same expiryStatus() the certifications use.
  issued_on    date,
  expires_on   date,
  -- Planning reference, certificate number, drawing number.
  reference    text,

  -- What this is about. All SET NULL: deleting a phase must not delete the
  -- photographs of it.
  phase_id     uuid references public.project_phases(id) on delete set null,
  task_id      uuid references public.tasks(id) on delete set null,
  contact_id   uuid references public.contacts(id) on delete set null,

  -- The CAPTURE date, which is not the upload date. A photo taken in February
  -- and uploaded in June belongs in February on the timeline, and `created_at`
  -- cannot say so.
  taken_at     date,
  -- Reusing the vocabulary already on expense_entries.location_room rather
  -- than inventing a second one.
  location_room text,

  -- ---- the version chain ----
  version_no    integer not null default 1 check (version_no >= 1),
  supersedes_id uuid references public.documents(id) on delete set null,
  -- Maintained by trg_documents_supersede below. Never set by application code
  -- except on the row being inserted. See the header for why it is stored.
  is_current    boolean not null default true,

  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint documents_dates_ordered
    check (issued_on is null or expires_on is null or expires_on >= issued_on),
  -- A document cannot supersede itself.
  constraint documents_not_self_superseding
    check (supersedes_id is null or supersedes_id <> id)
);

create index if not exists idx_documents_project
  on public.documents (project_id, doc_type);
create index if not exists idx_documents_current
  on public.documents (project_id) where is_current;
create index if not exists idx_documents_expiry
  on public.documents (expires_on) where expires_on is not null;
create index if not exists idx_documents_phase   on public.documents (phase_id);
create index if not exists idx_documents_task    on public.documents (task_id);
create index if not exists idx_documents_contact on public.documents (contact_id);
-- The photo timeline's one query: photos of a project, in capture order.
create index if not exists idx_documents_timeline
  on public.documents (project_id, taken_at) where doc_type = 'photo';
create unique index if not exists ux_documents_storage_path
  on public.documents (storage_path);

-- ============================================================
-- 2. The version chain keeps itself honest
-- ============================================================
-- Inserting rev C with supersedes_id = rev B clears rev B's is_current in the
-- same statement. Nothing else writes that column, so it cannot fall out of
-- step with the chain — which is the entire justification for storing it.
create or replace function public.documents_supersede()
returns trigger
language plpgsql
as $$
begin
  if new.supersedes_id is not null then
    update public.documents
       set is_current = false
     where id = new.supersedes_id
       and id <> new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_documents_supersede on public.documents;
create trigger trg_documents_supersede
  after insert or update of supersedes_id on public.documents
  for each row execute function public.documents_supersede();

drop trigger if exists trg_documents_updated on public.documents;
create trigger trg_documents_updated before update on public.documents
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. contact_certifications.document_id — the FK 0020 reserved
-- ============================================================
-- SET NULL: deleting the scan must not delete the record that the certificate
-- exists and expires in October.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contact_certifications_document_fk'
  ) then
    alter table public.contact_certifications
      add constraint contact_certifications_document_fk
      foreign key (document_id)
      references public.documents(id) on delete set null;
  end if;
end $$;

-- ============================================================
-- 4. RLS and grants — the 0015 shape
-- ============================================================
alter table public.documents enable row level security;
drop policy if exists "shared workspace" on public.documents;
create policy "shared workspace" on public.documents
  for all to authenticated using (true) with check (true);
grant all privileges on public.documents to authenticated;
grant all privileges on public.documents to service_role;

-- ============================================================
-- 5. Storage — a private `documents` bucket
-- ============================================================
-- Third bucket, and the last one. `receipts` (0001) and `invoices` (0010) hold
-- invoice evidence; this holds everything that is not an invoice.
--
-- The policy shape is 0015's, exactly: READ and DELETE are shared across every
-- signed-in user because this is one shared workspace, and INSERT still
-- demands that the first path segment be the uploader's own uuid. That
-- asymmetry is deliberate and inherited — it keeps the layout predictable
-- instead of becoming whatever each code path felt like.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "shared documents read" on storage.objects;
create policy "shared documents read" on storage.objects
  for select to authenticated using (bucket_id = 'documents');

drop policy if exists "shared documents delete" on storage.objects;
create policy "shared documents delete" on storage.objects
  for delete to authenticated using (bucket_id = 'documents');

drop policy if exists "own documents write" on storage.objects;
create policy "own documents write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 6. Assert
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'documents'
      and policyname = 'shared workspace' and qual = 'true'
  ) then
    raise exception 'documents is not shared — nothing committed.';
  end if;

  if not exists (select 1 from storage.buckets where id = 'documents') then
    raise exception 'the documents bucket was not created — nothing committed.';
  end if;

  raise notice 'Documents ready: 1 table, 1 private bucket, version chain by trigger.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report.
-- ------------------------------------------------------------------
select tablename, policyname, roles, qual
from pg_policies
where schemaname = 'public' and tablename = 'documents';

select id, name, public from storage.buckets order by id;
