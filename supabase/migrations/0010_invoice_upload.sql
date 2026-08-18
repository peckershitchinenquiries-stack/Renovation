-- RenovaTrack — 0010: invoice upload, supplier identity, and fuzzy matching.
--
-- Everything a photographed or PDF'd invoice needs on its way from the camera
-- roll into `purchases`:
--
--   1. `invoice_uploads` — one row per file, holding the extraction as it was
--      returned, verbatim, for ever. Nothing is written into purchases until a
--      human accepts the review screen, so a bad extraction is a row you can
--      look at rather than a purchase you have to unpick.
--   2. Supplier *identity* — a VAT number and an address, so "Lawsons" and
--      "Lawsons Timber Ltd" can be proven to be the same merchant instead of
--      guessed at. The VAT number is the only hard identifier an invoice
--      carries; everything else is spelling.
--   3. Fuzzy matching — pg_trgm indexes and two RPCs, so the review screen can
--      offer "did you mean Lawsons?" without shipping every supplier name to
--      the browser. Matching is a *suggestion*: `is_unverified` marks a
--      supplier the system created on its own, and a human confirms it later.
--
-- Additive. No existing table loses a column, no existing screen changes, and
-- every figure in about.md §13 must read the same afterwards.
--
-- Prerequisite: 0008 must already have been run (this extends `suppliers` and
-- references `purchases`).
--
-- Run in the Supabase SQL editor. Re-runnable — every statement is guarded.

begin;

-- Supabase installs extensions into `extensions`; a self-hosted Postgres may
-- have pg_trgm in `public`. Putting both on the path for this transaction
-- means the operator class below resolves either way, with nothing hard-coded.
set local search_path = public, extensions;

-- ============================================================
-- 0. Trigram matching
-- ============================================================
-- pg_trgm gives us similarity() and the GIN operator classes the two match_*
-- functions below index against. Supabase ships it; this just enables it.
create extension if not exists pg_trgm with schema extensions;

-- ============================================================
-- 1. Supplier identity — the columns that make a merchant provable
-- ============================================================
alter table public.suppliers
  add column if not exists vat_number text,
  add column if not exists address    text,
  -- Which upload invented this supplier, when nothing matched. Null for the
  -- ones seeded from the spreadsheet or typed by hand.
  add column if not exists created_from_upload_id uuid,
  -- true = created by the extractor and never confirmed by a human. The
  -- supplier screens can then say "unverified" rather than pretending the
  -- name came from anywhere authoritative.
  add column if not exists is_unverified boolean not null default false;

-- A VAT number reduced to its comparable form: alphanumerics only, upper-cased.
-- 'GB 123 4567 89', 'gb123456789' and 'GB-123-4567-89' are one number.
-- Deliberately does NOT strip the country prefix — two different countries can
-- issue the same digits, and merging those would be a real error.
-- IMMUTABLE so it can be used in an index expression, exactly like norm_key().
create or replace function public.norm_vat(t text)
returns text
language sql
immutable
strict
parallel safe
as $$ select nullif(upper(regexp_replace(t, '[^A-Za-z0-9]', '', 'g')), '') $$;

-- One VAT number, one supplier, per user. Partial: most suppliers have no VAT
-- number recorded and must not collide with each other on null.
create unique index if not exists ux_suppliers_user_vat
  on public.suppliers (user_id, public.norm_vat(vat_number))
  where public.norm_vat(vat_number) is not null;

-- ============================================================
-- 2. Trigram indexes for the name matchers
-- ============================================================
-- Indexed on the SAME normalisation the exact matcher uses (public.norm_key),
-- so the fuzzy path and the exact path can never disagree about what the text
-- of a name is before they start comparing it (about.md §4.6).
create index if not exists idx_suppliers_name_trgm
  on public.suppliers using gin (public.norm_key(name) gin_trgm_ops);
create index if not exists idx_supplier_aliases_trgm
  on public.supplier_aliases using gin (public.norm_key(alias) gin_trgm_ops);
create index if not exists idx_items_name_trgm
  on public.items using gin (public.norm_key(canonical_name) gin_trgm_ops);
create index if not exists idx_item_aliases_trgm
  on public.item_aliases using gin (public.norm_key(alias) gin_trgm_ops);

-- ============================================================
-- 3. invoice_uploads — one row per file
-- ============================================================
create table if not exists public.invoice_uploads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,

  -- Path in the private 'invoices' bucket, namespaced {auth.uid()}/… exactly
  -- as 'receipts' is (about.md §4.5).
  storage_path  text not null,
  original_name text,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),

  --   pending    — uploaded, nothing read yet
  --   processing — extraction in flight
  --   extracted  — we have a proposal; waiting for a human
  --   failed     — extraction gave up; `error` says why
  --   committed  — accepted and written into purchases
  -- Every one of these is terminal or advanced by exactly one code path, so an
  -- upload can never sit in 'processing' because a route threw.
  status        text not null default 'pending'
                  check (status in ('pending','processing','extracted','failed','committed')),
  error         text,

  -- The extractor's answer, exactly as it came back, for ever. This is the
  -- same idea as import_rows.raw: it is what the document said, and it is how
  -- a bad mapping gets re-done later without re-uploading the photo.
  extraction_raw jsonb,
  -- 'text'  — the PDF carried a real text layer and we read it
  -- 'vision'— there was no text layer, so the page images were read instead
  extraction_method text check (extraction_method is null
                       or extraction_method in ('text','vision')),
  page_count    integer check (page_count is null or page_count >= 0),

  -- The purchase this upload became, once committed. `set null` rather than
  -- cascade: deleting the invoice must not destroy the evidence it came from.
  invoice_id    uuid references public.purchases(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists ux_invoice_uploads_path
  on public.invoice_uploads (storage_path);
create index if not exists idx_invoice_uploads_project on public.invoice_uploads (project_id);
create index if not exists idx_invoice_uploads_user    on public.invoice_uploads (user_id);
create index if not exists idx_invoice_uploads_status  on public.invoice_uploads (status);
create index if not exists idx_invoice_uploads_invoice on public.invoice_uploads (invoice_id);

drop trigger if exists trg_invoice_uploads_updated on public.invoice_uploads;
create trigger trg_invoice_uploads_updated before update on public.invoice_uploads
  for each row execute function public.set_updated_at();

-- Now that the table exists, point the supplier provenance column at it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'suppliers_created_from_upload_fk'
  ) then
    alter table public.suppliers
      add constraint suppliers_created_from_upload_fk
      foreign key (created_from_upload_id)
      references public.invoice_uploads(id) on delete set null;
  end if;
end $$;

-- ============================================================
-- 4. The matchers
-- ============================================================
-- Both are SECURITY INVOKER (the default) and deliberately so: RLS on the
-- underlying tables is the only thing scoping data in this app (about.md §9).
-- A SECURITY DEFINER function here would hand every user everyone else's
-- suppliers, the same trap `expenses_view` avoids with security_invoker.
--
-- Neither function decides anything. They return candidates and a score; the
-- confidence banding and the "create a new one instead" decision live in
-- lib/invoice/resolve.ts, where a human can see them.

create or replace function public.match_suppliers(
  q text,
  match_limit integer default 5
)
returns table (
  supplier_id uuid,
  name        text,
  matched_on  text,
  score       real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with needle as (select public.norm_key(coalesce(q, '')) as k),
  hits as (
    select
      s.id                                          as sid,
      s.name                                        as sname,
      s.name                                        as via,
      similarity(public.norm_key(s.name), n.k)      as sc
    from public.suppliers s, needle n
    where n.k <> '' and public.norm_key(s.name) % n.k
    union all
    select
      a.supplier_id,
      s.name,
      a.alias,
      similarity(public.norm_key(a.alias), n.k)
    from public.supplier_aliases a
      join public.suppliers s on s.id = a.supplier_id,
      needle n
    where n.k <> '' and public.norm_key(a.alias) % n.k
  ),
  -- One row per supplier: the spelling that matched best is the one to show,
  -- so the review screen can say "matched on the alias 'Lawson Timber'".
  best as (
    select distinct on (h.sid) h.sid, h.sname, h.via, h.sc
    from hits h
    order by h.sid, h.sc desc, h.via asc
  )
  select b.sid, b.sname, b.via, b.sc
  from best b
  order by b.sc desc, b.sname asc
  limit greatest(coalesce(match_limit, 5), 1);
$$;

create or replace function public.match_items(
  q text,
  match_limit integer default 5
)
returns table (
  item_id    uuid,
  name       text,
  matched_on text,
  score      real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with needle as (select public.norm_key(coalesce(q, '')) as k),
  hits as (
    select
      i.id                                                   as iid,
      i.canonical_name                                       as iname,
      i.canonical_name                                       as via,
      similarity(public.norm_key(i.canonical_name), n.k)     as sc
    from public.items i, needle n
    where n.k <> '' and public.norm_key(i.canonical_name) % n.k
    union all
    select
      a.item_id,
      i.canonical_name,
      a.alias,
      similarity(public.norm_key(a.alias), n.k)
    from public.item_aliases a
      join public.items i on i.id = a.item_id,
      needle n
    where n.k <> '' and public.norm_key(a.alias) % n.k
  ),
  best as (
    select distinct on (h.iid) h.iid, h.iname, h.via, h.sc
    from hits h
    order by h.iid, h.sc desc, h.via asc
  )
  select b.iid, b.iname, b.via, b.sc
  from best b
  order by b.sc desc, b.iname asc
  limit greatest(coalesce(match_limit, 5), 1);
$$;

grant execute on function public.match_suppliers(text, integer) to authenticated;
grant execute on function public.match_items(text, integer)     to authenticated;

-- ============================================================
-- 5. One invoice number per supplier — pre-flight, then enforce
-- ============================================================
-- The whole point of logging invoices is that the same document cannot be
-- logged twice. Adding the index blind would fail with a bare "could not
-- create unique index" naming a row id and nothing else, so check first and
-- say exactly which documents are in the way.
do $$
declare
  v_dupes  bigint;
  v_detail text;
begin
  select count(*), string_agg(detail, e'\n')
    into v_dupes, v_detail
  from (
    select
      format('  supplier %s, invoice "%s" — %s purchases: %s',
             p.supplier_id, min(btrim(p.invoice_no)), count(*),
             string_agg(p.id::text, ', '))                     as detail
    from public.purchases p
    where p.supplier_id is not null
      and p.invoice_no is not null
      and btrim(p.invoice_no) <> ''
    group by p.user_id, p.supplier_id, public.norm_key(p.invoice_no)
    having count(*) > 1
  ) d;

  if coalesce(v_dupes, 0) > 0 then
    raise exception
      'Cannot add the one-invoice-per-supplier index: % duplicate group(s) already exist.%',
      v_dupes, e'\n' || v_detail
      using hint = 'Delete or renumber the duplicate purchases, then run 0010 again.';
  end if;
end $$;

-- Partial: an invoice with no number, or a purchase with no supplier, cannot
-- be compared against anything and must not collide on null.
create unique index if not exists ux_purchases_supplier_invoice
  on public.purchases (user_id, supplier_id, public.norm_key(invoice_no))
  where supplier_id is not null
    and invoice_no is not null
    and btrim(invoice_no) <> '';

-- ============================================================
-- 6. merge_suppliers — folding a duplicate into the real merchant
-- ============================================================
-- Fuzzy matching will eventually create "Lawsons Timber" next to "Lawsons".
-- This is how a human undoes that: every purchase is repointed, every spelling
-- the duplicate knew is remembered against the survivor, and only then is the
-- duplicate removed. Nothing is deleted before its history has been moved.
--
-- SECURITY INVOKER: RLS decides whose suppliers these are. A user cannot merge
-- a supplier they cannot see, because they cannot see it.
create or replace function public.merge_suppliers(
  source_id uuid,
  target_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source     public.suppliers%rowtype;
  v_target     public.suppliers%rowtype;
  v_purchases  bigint := 0;
  v_aliases    bigint := 0;
begin
  if source_id = target_id then
    raise exception 'A supplier cannot be merged into itself.';
  end if;

  select * into v_source from public.suppliers where id = source_id;
  if not found then raise exception 'Source supplier not found.'; end if;

  select * into v_target from public.suppliers where id = target_id;
  if not found then raise exception 'Target supplier not found.'; end if;

  -- Two different VAT numbers are two different merchants. Refuse rather than
  -- silently keep one of them: this is exactly the case the VAT number exists
  -- to catch (see lib/invoice/resolve.ts, the VAT override guard).
  if public.norm_vat(v_source.vat_number) is not null
     and public.norm_vat(v_target.vat_number) is not null
     and public.norm_vat(v_source.vat_number) <> public.norm_vat(v_target.vat_number)
  then
    raise exception
      'Refusing to merge: VAT numbers differ (% vs %).',
      v_source.vat_number, v_target.vat_number
      using hint = 'If one of them is wrong, correct it first, then merge.';
  end if;

  -- Move the documents. Done before anything is deleted, so a failure here
  -- leaves both suppliers intact rather than orphaning the purchases.
  update public.purchases
     set supplier_id = target_id
   where supplier_id = source_id;
  get diagnostics v_purchases = row_count;

  -- Remember every spelling the duplicate answered to, including its own name.
  --
  -- This MUST be an UPDATE, not an INSERT ... SELECT. ux_supplier_aliases_user_alias
  -- is unique on (user_id, norm_key(alias)) alone — it does not include
  -- supplier_id, because one spelling can only ever mean one supplier. So while
  -- the source's own alias rows still exist, an INSERT of the same text under
  -- target_id collides with them and "on conflict do nothing" silently drops
  -- it; the alias is then lost for good when the source cascade-deletes below.
  -- An UPDATE simply re-points the existing row and cannot conflict with itself.
  update public.supplier_aliases
     set supplier_id = target_id
   where supplier_id = source_id;

  insert into public.supplier_aliases (user_id, supplier_id, alias)
  values (v_target.user_id, target_id, v_source.name)
  on conflict do nothing;

  select count(*) into v_aliases
    from public.supplier_aliases where supplier_id = target_id;

  -- Fill in identity the survivor was missing rather than losing it.
  update public.suppliers
     set vat_number = coalesce(vat_number, v_source.vat_number),
         address    = coalesce(address,    v_source.address),
         account_ref= coalesce(account_ref,v_source.account_ref),
         notes      = coalesce(notes,      v_source.notes),
         -- A merge is a human decision, so the result is confirmed by
         -- definition.
         is_unverified = false
   where id = target_id;

  -- Its aliases were already re-pointed above, so nothing cascades away here.
  delete from public.suppliers where id = source_id;

  return jsonb_build_object(
    'merged_from',      v_source.name,
    'merged_into',      v_target.name,
    'target_id',        target_id,
    'purchases_moved',  v_purchases,
    'aliases_now',      v_aliases
  );
end $$;

grant execute on function public.merge_suppliers(uuid, uuid) to authenticated;

-- ============================================================
-- 7. Row-Level Security and grants
-- ============================================================
-- A new table with RLS enabled and no policy returns nothing; with RLS left
-- disabled it leaks everything. Both failure modes are silent (about.md §2).
alter table public.invoice_uploads enable row level security;

drop policy if exists "own invoice uploads" on public.invoice_uploads;
create policy "own invoice uploads" on public.invoice_uploads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.invoice_uploads to authenticated;

-- ============================================================
-- 8. Storage — a private 'invoices' bucket
-- ============================================================
-- Mirrors 'receipts' exactly (about.md §4.5): private, objects namespaced
-- {auth.uid()}/…, three policies. A separate bucket rather than a folder in
-- 'receipts' because these are documents pending review, not attachments to
-- something that already exists — and because the retention question for the
-- two is different.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "own invoices read" on storage.objects;
create policy "own invoices read" on storage.objects
  for select using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own invoices write" on storage.objects;
create policy "own invoices write" on storage.objects
  for insert with check (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own invoices delete" on storage.objects;
create policy "own invoices delete" on storage.objects
  for delete using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 9. Realtime — so the review screen learns the moment extraction finishes
-- ============================================================
-- The upload screen subscribes to its own row and re-renders when `status`
-- changes. It also polls, because realtime is a nicety and a stuck spinner is
-- not (see components/invoices/ExtractionStatus.tsx) — this only removes the
-- lag, it is never the only way the status arrives.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'invoice_uploads'
     )
  then
    alter publication supabase_realtime add table public.invoice_uploads;
  end if;
end $$;

-- Realtime sends the old row on an update only if it knows how to identify it;
-- the primary key is enough here, which is the default.
alter table public.invoice_uploads replica identity default;

-- ============================================================
-- 10. Report
-- ============================================================
do $$
declare
  v_suppliers bigint;
  v_vat       bigint;
  v_uploads   bigint;
begin
  select count(*) into v_suppliers from public.suppliers;
  select count(*) into v_vat from public.suppliers
    where public.norm_vat(vat_number) is not null;
  select count(*) into v_uploads from public.invoice_uploads;

  raise notice '0010 applied.';
  raise notice '  suppliers: %  (with a VAT number: %)', v_suppliers, v_vat;
  raise notice '  invoice_uploads: %', v_uploads;
  raise notice '  storage bucket "invoices": private, 3 policies';
  raise notice '  new RPCs: match_suppliers(), match_items(), merge_suppliers()';
end $$;

commit;
