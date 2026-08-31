-- RenovaTrack — 0015: turn the app from one-tenant-per-user into a single
-- shared workspace. Any signed-in user sees and edits everything.
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it there. Re-runnable.                 ##
-- ############################################################
--
-- Why
-- ---
-- 46 Glenferrie Road is one renovation with one set of books, and the owner
-- wants a couple of friends to work on it with him. Until now every table
-- carried the pattern
--
--     for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- which is a *multi-tenant* rule: it gives each account its own private,
-- empty copy of the app. So a friend created in the Supabase dashboard could
-- sign in perfectly well and then see nothing at all — no projects, no
-- expenses, no invoices — because every row in the database belongs to
-- admin@pk.com's uuid and RLS filtered all of them out. Nothing was broken;
-- the policies were doing exactly what they said.
--
-- What this changes
-- -----------------
-- Every policy becomes `to authenticated using (true) with check (true)`.
-- Signing in is now the whole of the authorisation model: one workspace,
-- shared by everyone with a login. Sign-up is still disabled and users are
-- still created by hand in the Supabase dashboard, so "everyone with a login"
-- means "everyone the owner has deliberately let in".
--
-- Read this before running it: this is a real widening. A friend can delete
-- the project, and there is no undo (see CLAUDE.md, "Data recovery"). That is
-- the trade being made on purpose, not an oversight.
--
-- `user_id` stays
-- ---------------
-- Every column, index, foreign key and unique constraint on `user_id` is left
-- exactly as it is, and every insert in the app still stamps the row with its
-- creator. Three reasons:
--
--   1. It is now provenance rather than permission — who added this expense.
--   2. `on delete cascade` still means deleting an auth user destroys the rows
--      they created. That hazard is unchanged and, if anything, sharper now:
--      deleting a *friend's* account deletes the work they did. Do not delete
--      auth users.
--   3. The Gmail routes run as `service_role`, where there is no `auth.uid()`
--      at all, and they read `user_id` off the account row to know who to file
--      an invoice for. That machinery is untouched.
--
-- No data is deleted by this file except duplicate trade lookups (see §3),
-- and no figure in about.md §13 moves.

begin;

-- ============================================================
-- 1. Table policies — 16 tables, one shared policy each
-- ============================================================
-- `to authenticated` is what keeps this from being a public database: the
-- `anon` role a signed-out browser uses is not granted the policy, so it
-- still matches no rows. `service_role` bypasses RLS entirely and is
-- unaffected either way (0014).
--
-- Done as a loop rather than 16 copy-pasted blocks so a table can never be
-- missed — a table left on the old policy would silently show a friend an
-- empty tab, which is the exact bug this file exists to fix.
do $$
declare
  t text;
  old_policy text;
begin
  for t, old_policy in
    select * from (values
      ('projects',         'own projects'),
      ('expense_entries',  'own expenses'),
      ('trade_lookups',    'own trades'),
      ('project_weeks',    'own weeks'),
      ('suppliers',        'own suppliers'),
      ('supplier_aliases', 'own supplier aliases'),
      ('items',            'own items'),
      ('item_aliases',     'own item aliases'),
      ('purchases',        'own purchases'),
      ('purchase_lines',   'own purchase lines'),
      ('payments',         'own payments'),
      ('receipts',         'own receipts rows'),
      ('invoice_uploads',  'own invoice uploads'),
      ('gmail_accounts',   'own gmail accounts'),
      ('gmail_events',     'own gmail events'),
      ('supplier_domains', 'own supplier domains')
    ) as v(table_name, policy_name)
  loop
    -- A table that does not exist yet means a migration was skipped. Say so
    -- rather than half-applying this one.
    if to_regclass('public.' || t) is null then
      raise exception
        'Table public.% does not exist — run the earlier migrations first.', t;
    end if;

    execute format('alter table public.%I enable row level security', t);
    -- %I, not %L: a policy name is an identifier, so it needs double quotes.
    execute format('drop policy if exists %I on public.%I', old_policy, t);
    execute format('drop policy if exists "shared workspace" on public.%I', t);
    execute format(
      'create policy "shared workspace" on public.%I '
      'for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================
-- 2. Storage — the receipt and invoice files
-- ============================================================
-- Both buckets are private and both were laid out as `{user.id}/…`, with
-- policies keyed on `storage.foldername(name)[1] = auth.uid()::text`. Sharing
-- the *rows* without sharing the *files* would have been the worst of both
-- worlds: a friend sees an invoice in the list, clicks it, and the signed URL
-- fails, because `createSignedUrl` runs under their session and storage RLS
-- refused them the object.
--
-- SELECT and DELETE become shared. DELETE has to move with SELECT or a friend
-- deleting a receipt would clear `expense_entries.receipt_url` and leave the
-- file orphaned in the bucket.
--
-- INSERT deliberately does NOT move: it still demands that the first path
-- segment be the uploader's own uuid. Nothing in the app writes anywhere else
-- (app/api/invoices/upload-url/route.ts, app/api/expenses/[eid]/receipt/route.ts),
-- and keeping the rule means the layout stays predictable instead of becoming
-- whatever each code path felt like.
drop policy if exists "own receipts read"   on storage.objects;
drop policy if exists "own receipts delete" on storage.objects;
drop policy if exists "own invoices read"   on storage.objects;
drop policy if exists "own invoices delete" on storage.objects;

drop policy if exists "shared receipts read" on storage.objects;
create policy "shared receipts read" on storage.objects
  for select to authenticated using (bucket_id = 'receipts');

drop policy if exists "shared receipts delete" on storage.objects;
create policy "shared receipts delete" on storage.objects
  for delete to authenticated using (bucket_id = 'receipts');

drop policy if exists "shared invoices read" on storage.objects;
create policy "shared invoices read" on storage.objects
  for select to authenticated using (bucket_id = 'invoices');

drop policy if exists "shared invoices delete" on storage.objects;
create policy "shared invoices delete" on storage.objects
  for delete to authenticated using (bucket_id = 'invoices');

-- The two write policies are recreated verbatim, so this file is complete on
-- its own and a re-run cannot leave the bucket unwritable.
drop policy if exists "own receipts write" on storage.objects;
create policy "own receipts write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own invoices write" on storage.objects;
create policy "own invoices write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 3. Trade lookups — stop the seed trigger duplicating the list
-- ============================================================
-- 0001 put a trigger on auth.users that seeds thirteen default trades for
-- every new account. Under the old per-user policies each account saw only
-- its own thirteen. Shared, the second person to sign in turns the "Trade"
-- dropdown into twenty-six entries — Plumber, Plumber, Electrician,
-- Electrician — and the third makes it thirty-nine.
--
-- `expense_entries.trade` and `purchases.trade` store the trade as a plain
-- name string with no foreign key (about.md §4.2/§4.6), so removing a
-- duplicate lookup row cannot orphan anything. The oldest row of each name
-- wins, which is the owner's original seed.
delete from public.trade_lookups t
where exists (
  select 1 from public.trade_lookups keep
  where lower(btrim(keep.name)) = lower(btrim(t.name))
    and (keep.created_at, keep.id) < (t.created_at, t.id)
);

-- Now that the list is one shared list, the name is unique across the whole
-- table, not per user. The POST /api/lookups/trades route already turns a
-- 23505 into a readable 409, so this index gives that message its correct
-- meaning instead of letting two people create two "Plasterer"s.
create unique index if not exists ux_trade_lookups_name
  on public.trade_lookups (lower(btrim(name)));

-- The trigger itself: seed only when the table is empty, i.e. on the very
-- first account of a fresh database. Everyone after that inherits the shared
-- list. `on conflict` is kept for the race where two accounts are created at
-- the same instant.
create or replace function public.seed_trade_lookups()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.trade_lookups) then
    return new;
  end if;

  insert into public.trade_lookups (user_id, name, default_rate, default_markup_pct) values
    (new.id, 'General Builder',  45, 10),
    (new.id, 'Carpenter/Joiner', 50, 10),
    (new.id, 'Plumber',          60, 10),
    (new.id, 'Electrician',      65, 10),
    (new.id, 'Plasterer',        55, 10),
    (new.id, 'Tiler',            55, 10),
    (new.id, 'Decorator',        45, 10),
    (new.id, 'Roofer',           60, 10),
    (new.id, 'Groundworker',     55, 10),
    (new.id, 'Kitchen Fitter',   55, 10),
    (new.id, 'Bathroom Fitter',  55, 10),
    (new.id, 'Skip/Disposal',     0,  0),
    (new.id, 'Other',            50, 10)
  on conflict do nothing;
  return new;
end;
$$;

-- ============================================================
-- 4. Supplier domains — likewise one shared trust list
-- ============================================================
-- `ux_supplier_domains_user_domain` from 0013 is unique on
-- (user_id, norm_key(domain)), which under sharing lets two people trust the
-- same sender and produce two rows for it. That matters for more than tidiness:
-- /api/invoices/[id]/triage reads the table back with `.maybeSingle()`, and a
-- second row would turn a harmless re-trust into a 500.
--
-- The per-user index is left in place; this one is simply stricter. Together
-- they make the triage route's existing "treat 23505 as success" branch
-- correct again — which is what it was relying on before sharing, when the
-- per-user index was doing that job.
--
-- `domainOf()` in lib/gmail/domains.ts already lowercases and trims before
-- writing, so norm_key() here is belt and braces rather than a new rule.
delete from public.supplier_domains d
where exists (
  select 1 from public.supplier_domains keep
  where public.norm_key(keep.domain) = public.norm_key(d.domain)
    and (keep.created_at, keep.id) < (d.created_at, d.id)
);

create unique index if not exists ux_supplier_domains_domain
  on public.supplier_domains (public.norm_key(domain));

-- ============================================================
-- 5. Assert the policies actually took
-- ============================================================
-- A wrong policy here does not error — it returns an empty screen, which is
-- indistinguishable from "no data yet" (about.md §2). So check now, loudly,
-- rather than discovering it when a friend logs in and sees nothing.
do $$
declare
  t text;
  missing text[] := '{}';
begin
  foreach t in array array[
    'projects', 'expense_entries', 'trade_lookups', 'project_weeks',
    'suppliers', 'supplier_aliases', 'items', 'item_aliases',
    'purchases', 'purchase_lines', 'payments', 'receipts',
    'invoice_uploads', 'gmail_accounts', 'gmail_events', 'supplier_domains'
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
      'Still not shared: % — nothing committed.', array_to_string(missing, ', ');
  end if;

  raise notice 'All 16 tables are now shared across signed-in users.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Every public table should show exactly one policy, named
-- "shared workspace", with both USING and WITH CHECK reading `true`.
-- Any row still saying `(auth.uid() = user_id)` is a table a friend
-- will find empty.
-- ------------------------------------------------------------------
select tablename, policyname, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
