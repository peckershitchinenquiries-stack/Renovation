-- RenovaTrack — 0012: let an invoice be uploaded before its project is chosen.
--
-- The problem this fixes
-- ----------------------
-- `invoice_uploads.project_id` was `not null` (0010), which forced the whole
-- ingestion flow to begin inside a project: you had to open the project, then
-- Invoices, then Upload, before you could photograph anything. In practice the
-- project is the *last* thing you know — you have a pile of invoices and you
-- decide which job each belongs to while looking at it.
--
-- Uploading now happens from the nav bar, and the project is chosen on the
-- review screen, at the moment the invoice is saved.
--
-- What changes
-- ------------
-- One column stops being mandatory. An uploaded-but-not-yet-saved invoice now
-- honestly holds `project_id is null` — "nobody has said yet" — rather than a
-- project the user never picked. POST /api/invoices/[id]/commit fills it in
-- from the review screen's Project field at the same moment it writes the
-- purchase, so a *committed* upload always has one.
--
-- Nothing reads this column except that commit, so no screen, total or figure
-- in about.md §13 moves. The foreign key and its `on delete cascade` are
-- untouched: deleting a project still takes its uploads with it.
--
-- Existing rows keep whatever project they already had — this only widens what
-- is allowed, so no row can become invalid.
--
-- Prerequisite: 0010 must already have been run.
--
-- Run in the Supabase SQL editor. Re-runnable.

begin;

alter table public.invoice_uploads
  alter column project_id drop not null;

-- A committed upload with no project would mean the commit route wrote a
-- purchase without knowing where to file it — that must never happen, so it is
-- worth asserting here rather than discovering it in a total months later.
alter table public.invoice_uploads
  drop constraint if exists invoice_uploads_committed_has_project;

alter table public.invoice_uploads
  add constraint invoice_uploads_committed_has_project
  check (status <> 'committed' or project_id is not null);

-- The column must actually be nullable now. If this migration is pasted into
-- the wrong database the ALTER above is a silent no-op-looking success, and the
-- app would then 500 on every upload with a not-null violation instead.
do $$
declare
  v_notnull boolean;
begin
  select attnotnull into v_notnull
  from pg_attribute
  where attrelid = 'public.invoice_uploads'::regclass
    and attname = 'project_id'
    and attnum > 0;

  if v_notnull then
    raise exception
      'invoice_uploads.project_id is still NOT NULL — nothing committed.';
  end if;

  raise notice 'invoice_uploads.project_id is now nullable until commit.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report: uploads that have no project yet. Expect 0 immediately after this
-- runs — rows only become project-less once you upload from the nav bar.
-- ------------------------------------------------------------------
select status, count(*) filter (where project_id is null) as without_project,
       count(*) as total
from public.invoice_uploads
group by status
order by status;
