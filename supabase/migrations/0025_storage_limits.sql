-- RenovaTrack — 0025: make the upload limits real
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it AFTER 0024. Re-runnable.            ##
-- ############################################################
--
-- Why
-- ---
-- Two of the three upload paths in this app hand the browser a SIGNED UPLOAD
-- URL and let it PUT the bytes straight at Supabase Storage, because Vercel
-- caps a serverless request body at 4.5MB and a phone photo is bigger than
-- that. The route never sees the file. What it sees is a JSON body saying
-- "this is a 2MB image/png", and it checks THAT:
--
--   app/api/documents/upload-url/route.ts   25MB, DOCUMENT_MIME_TYPES (9)
--   app/api/invoices/upload-url/route.ts    20MB, 4 types
--
-- Those checks are therefore advisory. The size and the type are whatever the
-- client said they were, and the signed URL that comes back accepts anything:
-- declare 1KB of image/png, PUT half a gigabyte of something else, and both
-- checks pass because neither was ever looking at the file. Nothing enforced
-- them, because `storage.buckets` was created with no limits at all —
-- `0001` (receipts), `0010` (invoices) and `0021` (documents) all insert the
-- bucket with only `id`, `name` and `public`.
--
-- This sets `file_size_limit` and `allowed_mime_types` on the buckets, which
-- Storage enforces at upload time on the actual request. After this, the
-- checks in the route are the FIRST line — a fast, friendly rejection with a
-- message under the right field — and the bucket is the one that cannot be
-- talked around.
--
-- What this does NOT do, and it matters
-- -------------------------------------
-- `allowed_mime_types` is checked against the content-type the uploader
-- DECLARES. Storage does not sniff magic bytes. So a signed-in user can still
-- store arbitrary bytes labelled `image/png`, and this migration does not
-- claim otherwise. What it does close completely is the size hole — bytes are
-- bytes and the limit is enforced on them — and it stops the casual case of a
-- file that is simply the wrong kind. Sniffing content after the fact would
-- need a service-role read of every uploaded object and is a separate piece of
-- work; see about.md §9.2.
--
-- The one thing to get right here
-- -------------------------------
-- `invoices` has TWO writers, not one, and they do not allow the same types:
--
--   * the manual upload route — jpeg, png, webp, pdf, up to 20MB
--   * the Gmail drain (`ATTACHMENT_MIME_TYPES` in app/api/gmail/drain/route.ts)
--     — pdf, jpeg, png, **heic**, up to 15MB
--
-- So the bucket is set to the UNION of the two, not to either list. Setting it
-- to the manual route's list would reject every HEIC attachment arriving from
-- an iPhone by email — and per CLAUDE.md, Gmail ingestion fails SILENTLY: the
-- event is marked done, the cursor moves past it, and that mail is stranded
-- for ever. That is the third time this shape of bug would have been
-- introduced here. The union is deliberate and it is load-bearing.
--
-- `receipts` (0001) is different again: that route POSTs the file THROUGH the
-- handler, so its size and type are already checked against the real bytes.
-- Limits are set on it anyway, for defence in depth and so all three buckets
-- read the same way.
--
-- If a list changes in code, change it here too. That pairing is the same rule
-- about.md §2 rule 4 states for CHECK constraints and the arrays in
-- `types/index.ts`: two places, changed together, always.

begin;

-- ============================================================
-- 0. Refuse to run against a Storage schema that cannot hold limits
-- ============================================================
-- These two columns have been in `storage.buckets` for a long time, but a very
-- old project would not have them, and silently doing nothing is exactly the
-- failure this migration exists to stop.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    raise exception
      'storage.buckets has no file_size_limit/allowed_mime_types on this project — nothing committed.';
  end if;
end $$;

-- ============================================================
-- 1. documents — 25MB (0021)
-- ============================================================
-- Matches DOCUMENT_MIME_TYPES in lib/documents.ts — which is now the single
-- list in code, read by BOTH the upload route and the file picker. Those two
-- used to be separate and disagreed: the picker said `image/*`, so a GIF, a
-- BMP or a TIFF was offered and then refused with a 415 after the whole form
-- had been filled in.
--
-- One deliberate difference from anything a browser might offer:
-- **image/svg+xml is not here, and is not in the code list either.** An SVG is
-- a scripted document, not a picture, and this bucket is served inline through
-- a redirect to a signed URL. Nothing in the app needs one — drawings arrive
-- as PDFs — so it is simply not accepted.
--
-- `image/heif` is new here (2026-09-22) and is the same iPhone container as
-- `image/heic` under its other name. iOS and Windows hand over one or the
-- other depending on version, so accepting only `heic` was a guaranteed
-- rejection of a photograph the user was entitled to add. Widening this is the
-- point — do not narrow it back to heic alone.
update storage.buckets
   set file_size_limit = 26214400,  -- 25 * 1024 * 1024
       allowed_mime_types = array[
         'image/jpeg',
         'image/png',
         'image/webp',
         'image/heic',
         'image/heif',
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/msword',
         'text/plain'
       ]
 where id = 'documents';

-- ============================================================
-- 2. invoices — 20MB (0010)
-- ============================================================
-- The UNION of the manual route and the Gmail drain. Read the header before
-- narrowing this: dropping 'image/heic' strands emailed iPhone photos with no
-- error anywhere.
update storage.buckets
   set file_size_limit = 20971520,  -- 20 * 1024 * 1024
       allowed_mime_types = array[
         'image/jpeg',
         'image/png',
         'image/webp',   -- manual upload only
         'image/heic',   -- Gmail drain only; see the header
         'application/pdf'
       ]
 where id = 'invoices';

-- ============================================================
-- 3. receipts — 10MB (0001)
-- ============================================================
-- Already enforced in the route, which sees the real bytes. Belt and braces.
update storage.buckets
   set file_size_limit = 10485760,  -- 10 * 1024 * 1024
       allowed_mime_types = array[
         'image/jpeg',
         'image/png',
         'image/webp',
         'application/pdf'
       ]
 where id = 'receipts';

-- ============================================================
-- 4. Assert — a limit that was not applied is worse than none,
--    because it would be believed
-- ============================================================
do $$
declare
  unlimited text;
begin
  select string_agg(id, ', ')
    into unlimited
    from storage.buckets
   where id in ('documents', 'invoices', 'receipts')
     and (file_size_limit is null or allowed_mime_types is null);

  if unlimited is not null then
    raise exception 'these buckets are still unlimited: % — nothing committed.', unlimited;
  end if;

  -- The one that fails silently if it is wrong.
  if not exists (
    select 1 from storage.buckets
     where id = 'invoices' and 'image/heic' = any (allowed_mime_types)
  ) then
    raise exception
      'invoices must accept image/heic or the Gmail drain strands iPhone attachments — nothing committed.';
  end if;

  if exists (
    select 1 from storage.buckets
     where id = 'documents' and 'image/svg+xml' = any (allowed_mime_types)
  ) then
    raise exception 'documents must not accept SVG — nothing committed.';
  end if;

  raise notice 'Upload limits are now enforced by Storage on all three buckets.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Sizes in MB, so the numbers are readable.
-- ------------------------------------------------------------------
select id,
       public,
       round(file_size_limit / 1024.0 / 1024.0, 1) as limit_mb,
       allowed_mime_types
  from storage.buckets
 order by id;
