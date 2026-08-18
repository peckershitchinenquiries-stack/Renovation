-- RenovaTrack — 0008: the Route C transaction core.
--
-- Adds suppliers, items, purchases, purchase lines, payments and receipts
-- alongside the existing schema, then copies every expense_entries row into
-- the new shape. NOTHING existing is changed: no column is dropped, no screen
-- is touched, and every figure in about.md §13 must read the same afterwards.
--
-- Prerequisite: 0007 must already have been run. This migration copies
-- whatever is in expense_entries at the time it runs. If 0007 is run *after*
-- this one it will delete the project and its expense rows, taking the
-- backfilled purchases with it (project_id is on delete cascade) — in that
-- case just run this file again, it is re-runnable.
--
-- Money mapping — the single easiest thing to get wrong (about.md §2, §3.1):
--   actual_amount is EX-VAT   → purchases.net_total and purchase_lines.line_net
--   vat_total                 = round(actual_amount × vat_rate / 100, 2)
--   gross_total               = net_total + vat_total, a GENERATED column, so
--                               it can never drift out of step
--   paid_amount is INCL-VAT   → payments.amount, copied across unchanged
--   quoted_amount is INCL-VAT for the Glenferrie import → purchases.quoted_gross
--                               (kept out of net/vat/gross deliberately)
-- No balance and no payment status is stored anywhere. Balance is
--   gross_total − Σ payments.amount
-- and the Paid / Partial / Pending status derives from it, computed on read by
-- lib/purchases.ts, exactly as lib/calculations.ts does for expense entries.
--
-- Run in the Supabase SQL editor. Re-runnable: it deletes the previous
-- backfill first (origin = 'legacy_import') and refuses to commit unless the
-- copied money and row counts match expense_entries.

begin;

-- ============================================================
-- 0. Shared text normalisation
-- ============================================================
-- Same rule as priceKey() in lib/summary.ts: trim, lower-case, collapse
-- internal whitespace. Used by every uniqueness index below, so the database,
-- the Price Tracker and the alias matcher all agree on what "one item" means.
-- Must be IMMUTABLE to be usable in an index expression.
create or replace function public.norm_key(t text)
returns text
language sql
immutable
strict
parallel safe
as $$ select lower(btrim(regexp_replace(t, '\s+', ' ', 'g'))) $$;

-- ============================================================
-- 1. Global reference data — suppliers and items
-- ============================================================
-- "Global" means above the project: one supplier record is shared by every
-- project. It is still per-user, because RLS is the only thing scoping data
-- in this app (about.md §9).

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  type        text,
  account_ref text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists ux_suppliers_user_name
  on public.suppliers (user_id, public.norm_key(name));

create table if not exists public.supplier_aliases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  alias       text not null check (btrim(alias) <> ''),
  created_at  timestamptz not null default now()
);

-- One alias maps to exactly one supplier per user — that is the whole point.
create unique index if not exists ux_supplier_aliases_user_alias
  on public.supplier_aliases (user_id, public.norm_key(alias));
create index if not exists idx_supplier_aliases_supplier
  on public.supplier_aliases (supplier_id);

create table if not exists public.items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  canonical_name text not null check (btrim(canonical_name) <> ''),
  category       text check (category is null or category in
                   ('Labour','Materials','Skip/Disposal','Other')),
  default_unit   text,
  pack_size      numeric(12,3) check (pack_size is null or pack_size > 0),
  pack_unit      text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists ux_items_user_name
  on public.items (user_id, public.norm_key(canonical_name));

create table if not exists public.item_aliases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  alias      text not null check (btrim(alias) <> ''),
  created_at timestamptz not null default now()
);

create unique index if not exists ux_item_aliases_user_alias
  on public.item_aliases (user_id, public.norm_key(alias));
create index if not exists idx_item_aliases_item
  on public.item_aliases (item_id);

-- ============================================================
-- 2. purchases — one row per document, not per item
-- ============================================================
create table if not exists public.purchases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  supplier_id     uuid references public.suppliers(id) on delete set null,

  -- The legacy rows have no purchase date. The spreadsheet only ever had a
  -- hand-typed Paid Date, so that is what the backfill puts here, and it is
  -- null on the 91 rows that were never paid. This mirrors what the Price
  -- Tracker already does (about.md §6.8) rather than inventing a date.
  purchase_date   date,
  week_no         integer check (week_no is null or week_no > 0),
  invoice_no      text,

  category        text check (category is null or category in
                    ('Labour','Materials','Skip/Disposal','Other')),
  -- Carried over from expense_entries so nothing is lost in the copy. Free
  -- text, matched against trade_lookups.name by convention only — no FK,
  -- same as before.
  trade           text,
  location_room   text,
  notes           text,

  net_total       numeric(12,2) not null default 0 check (net_total >= 0),
  vat_total       numeric(12,2) not null default 0 check (vat_total >= 0),
  -- Generated, never written by hand: it cannot drift away from its parts.
  gross_total     numeric(12,2) generated always as (net_total + vat_total) stored,
  -- What was quoted, incl-VAT for the Glenferrie import (about.md §3.1).
  -- Deliberately outside net/vat/gross, which describe what was actually spent.
  quoted_gross    numeric(12,2) check (quoted_gross is null or quoted_gross >= 0),

  -- Where the data came from.
  origin          text not null default 'manual'
                    check (origin in ('manual','excel','text','invoice_ocr','legacy_import')),
  -- Which half of the app this belongs to. about.md §5: diary and ledger rows
  -- overlap, so summing them double-counts. This is NOT the same question as
  -- `origin` — do not merge the two.
  entry_source    text not null default 'diary'
                    check (entry_source in ('diary','ledger')),
  -- The lifecycle flag copied from expense_entries.status. It is not a payment
  -- state — Paid/Partial/Pending is derived from payments, never stored. This
  -- is here because 'Cancelled' has to survive the copy: every summary in the
  -- app excludes cancelled rows.
  entry_status    text not null default 'Planned'
                    check (entry_status in ('Planned','In Progress','Paid','Cancelled')),

  source_file_id  text,
  -- Traceability back to the row this was copied from, and the key that makes
  -- this migration re-runnable.
  legacy_entry_id uuid unique references public.expense_entries(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_purchases_project   on public.purchases (project_id);
create index if not exists idx_purchases_user      on public.purchases (user_id);
create index if not exists idx_purchases_supplier  on public.purchases (supplier_id);
create index if not exists idx_purchases_date      on public.purchases (purchase_date);
create index if not exists idx_purchases_source    on public.purchases (project_id, entry_source);

-- ============================================================
-- 3. purchase_lines — the items on the document
-- ============================================================
create table if not exists public.purchase_lines (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  purchase_id     uuid not null references public.purchases(id) on delete cascade,
  line_no         integer not null default 1 check (line_no > 0),
  item_id         uuid references public.items(id) on delete set null,
  -- What the document actually said, kept verbatim and for ever. If the item
  -- match is corrected later, this still shows the original wording.
  description_raw text not null check (btrim(description_raw) <> ''),
  qty             numeric(12,3) not null default 0 check (qty >= 0),
  unit            text,
  -- Four decimal places: unit prices are not always round pennies.
  unit_price      numeric(12,4) not null default 0 check (unit_price >= 0),
  -- Ex-VAT, like actual_amount. Stored rather than computed from qty ×
  -- unit_price because invoices carry discounts and roundings of their own.
  line_net        numeric(12,2) not null default 0 check (line_net >= 0),
  vat_rate        numeric(5,2)  not null default 0 check (vat_rate in (0,20)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (purchase_id, line_no)
);

create index if not exists idx_purchase_lines_purchase on public.purchase_lines (purchase_id);
create index if not exists idx_purchase_lines_item     on public.purchase_lines (item_id);
create index if not exists idx_purchase_lines_user     on public.purchase_lines (user_id);

-- ============================================================
-- 4. payments — one row per time money changed hands
-- ============================================================
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  -- Nullable: 20 of the legacy rows have a date, the rest were paid with no
  -- date recorded or not paid at all.
  paid_on     date,
  -- Incl-VAT: this is the sum actually handed over (about.md §3.1).
  amount      numeric(12,2) not null check (amount >= 0),
  method      text check (method is null or method in
                ('Cash','Debit Card','Credit Card','Bank Transfer')),
  reference   text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_payments_purchase on public.payments (purchase_id);
create index if not exists idx_payments_user     on public.payments (user_id);
create index if not exists idx_payments_date     on public.payments (paid_on);

-- ============================================================
-- 5. receipts — attachments, now hung off the document
-- ============================================================
create table if not exists public.receipts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  purchase_id  uuid not null references public.purchases(id) on delete cascade,
  -- Path in the existing private 'receipts' storage bucket, namespaced
  -- {auth.uid()}/… exactly as before.
  storage_path text not null,
  uploaded_at  timestamptz not null default now()
);

create index if not exists idx_receipts_purchase on public.receipts (purchase_id);

-- ============================================================
-- 6. updated_at triggers (reusing public.set_updated_at from 0001)
-- ============================================================
drop trigger if exists trg_suppliers_updated on public.suppliers;
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_items_updated on public.items;
create trigger trg_items_updated before update on public.items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_purchases_updated on public.purchases;
create trigger trg_purchases_updated before update on public.purchases
  for each row execute function public.set_updated_at();

drop trigger if exists trg_purchase_lines_updated on public.purchase_lines;
create trigger trg_purchase_lines_updated before update on public.purchase_lines
  for each row execute function public.set_updated_at();

-- ============================================================
-- 7. Row-Level Security — one policy per table, the project's pattern
-- ============================================================
-- A new table with RLS enabled and no policy returns nothing; with RLS left
-- disabled it leaks everything. Both failure modes are silent (about.md §2).
alter table public.suppliers        enable row level security;
alter table public.supplier_aliases enable row level security;
alter table public.items            enable row level security;
alter table public.item_aliases     enable row level security;
alter table public.purchases        enable row level security;
alter table public.purchase_lines   enable row level security;
alter table public.payments         enable row level security;
alter table public.receipts         enable row level security;

drop policy if exists "own suppliers" on public.suppliers;
create policy "own suppliers" on public.suppliers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own supplier aliases" on public.supplier_aliases;
create policy "own supplier aliases" on public.supplier_aliases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own item aliases" on public.item_aliases;
create policy "own item aliases" on public.item_aliases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own purchases" on public.purchases;
create policy "own purchases" on public.purchases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own purchase lines" on public.purchase_lines;
create policy "own purchase lines" on public.purchase_lines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own receipts rows" on public.receipts;
create policy "own receipts rows" on public.receipts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on
  public.suppliers, public.supplier_aliases, public.items, public.item_aliases,
  public.purchases, public.purchase_lines, public.payments, public.receipts
  to authenticated;

-- ============================================================
-- 8. Backfill — every expense entry becomes one purchase + one line
-- ============================================================
do $$
declare
  v_entries    bigint;
  v_purchases  bigint;
  v_lines      bigint;
  v_payments   bigint;
  v_paid_rows  bigint;
  v_new_sup    bigint;
  v_new_item   bigint;
  v_unlinked   bigint;
begin
  select count(*) into v_entries from public.expense_entries;
  if v_entries = 0 then
    raise exception 'expense_entries is empty — has 0007 been run? Nothing to copy.';
  end if;

  -- purchase_lines.description_raw rejects a blank. Fail here with something
  -- readable rather than on a constraint 200 lines further down.
  if exists (select 1 from public.expense_entries where btrim(description) = '') then
    raise exception 'Some expense rows have a blank description; they cannot become purchase lines.';
  end if;

  -- Idempotency. Cascades to lines, payments and receipts.
  delete from public.purchases where origin = 'legacy_import';

  -- ---- suppliers -------------------------------------------------
  -- Seeded from expense_entries.supplier only. The `trade` column holds trade
  -- categories (General Builder, Plumber…), not merchant names, so it is left
  -- alone — purchases keep their own `trade` text and the Trades tab is
  -- unaffected. Seeding is literal: "Lawson" and "Lawsons" become two
  -- suppliers. Merging near-duplicates is Phase 3's alias work, not a guess
  -- made here.
  with seed as (
    select distinct on (e.user_id, public.norm_key(e.supplier))
           e.user_id, btrim(e.supplier) as name
    from public.expense_entries e
    where e.supplier is not null and btrim(e.supplier) <> ''
    order by e.user_id, public.norm_key(e.supplier), e.created_at
  )
  insert into public.suppliers (user_id, name, notes)
  select user_id, name, 'Seeded from expense_entries.supplier by migration 0008.'
  from seed
  on conflict (user_id, (public.norm_key(name))) do nothing;
  get diagnostics v_new_sup = row_count;

  insert into public.supplier_aliases (user_id, supplier_id, alias)
  select s.user_id, s.id, s.name from public.suppliers s
  on conflict (user_id, (public.norm_key(alias))) do nothing;

  -- ---- items -----------------------------------------------------
  -- Keyed on the normalised description, the same key the Price Tracker groups
  -- on, so the two can never disagree about what one item is. The display name
  -- and category come from the most recent row, matching buildPriceHistory.
  with seed as (
    select distinct on (e.user_id, public.norm_key(e.description))
           e.user_id, btrim(e.description) as canonical_name, e.category
    from public.expense_entries e
    where e.description is not null and btrim(e.description) <> ''
    order by e.user_id, public.norm_key(e.description), e.created_at desc
  )
  insert into public.items (user_id, canonical_name, category, notes)
  select user_id, canonical_name, category,
         'Seeded from expense_entries.description by migration 0008.'
  from seed
  on conflict (user_id, (public.norm_key(canonical_name))) do nothing;
  get diagnostics v_new_item = row_count;

  insert into public.item_aliases (user_id, item_id, alias)
  select i.user_id, i.id, i.canonical_name from public.items i
  on conflict (user_id, (public.norm_key(alias))) do nothing;

  -- ---- purchases -------------------------------------------------
  insert into public.purchases (
    user_id, project_id, supplier_id, purchase_date, week_no, invoice_no,
    category, trade, location_room, notes,
    net_total, vat_total, quoted_gross,
    origin, entry_source, entry_status, legacy_entry_id, created_at, updated_at
  )
  select
    e.user_id,
    e.project_id,
    s.id,
    e.paid_date,                                    -- the only date the source has
    e.week_number,
    e.invoice_ref,
    e.category,
    e.trade,
    e.location_room,
    e.notes,
    e.actual_amount,                                -- ex-VAT
    round(e.actual_amount * e.vat_rate / 100, 2),   -- gross_total is generated
    e.quoted_amount,                                -- incl-VAT, kept apart
    'legacy_import',
    e.source,                                       -- diary / ledger, preserved
    e.status,
    e.id,
    e.created_at,
    e.updated_at
  from public.expense_entries e
  left join public.suppliers s
    on  s.user_id = e.user_id
    and public.norm_key(s.name) = public.norm_key(e.supplier);

  -- ---- lines -----------------------------------------------------
  insert into public.purchase_lines (
    user_id, purchase_id, line_no, item_id, description_raw,
    qty, unit, unit_price, line_net, vat_rate, created_at, updated_at
  )
  select
    p.user_id, p.id, 1, i.id, e.description,
    e.qty,
    null,                                           -- the source records no unit
    e.unit_cost,
    e.actual_amount,
    e.vat_rate,
    e.created_at, e.updated_at
  from public.purchases p
  join public.expense_entries e on e.id = p.legacy_entry_id
  left join public.items i
    on  i.user_id = e.user_id
    and public.norm_key(i.canonical_name) = public.norm_key(e.description)
  where p.origin = 'legacy_import';

  -- ---- payments --------------------------------------------------
  insert into public.payments (
    user_id, purchase_id, paid_on, amount, method, created_at
  )
  select p.user_id, p.id, e.paid_date, e.paid_amount, e.payment_method, e.created_at
  from public.purchases p
  join public.expense_entries e on e.id = p.legacy_entry_id
  where p.origin = 'legacy_import'
    and e.paid_amount > 0;

  -- ---- receipts --------------------------------------------------
  insert into public.receipts (user_id, purchase_id, storage_path, uploaded_at)
  select p.user_id, p.id, e.receipt_url, e.created_at
  from public.purchases p
  join public.expense_entries e on e.id = p.legacy_entry_id
  where p.origin = 'legacy_import'
    and e.receipt_url is not null and btrim(e.receipt_url) <> '';

  select count(*) into v_purchases from public.purchases where origin = 'legacy_import';
  select count(*) into v_lines from public.purchase_lines pl
    join public.purchases p on p.id = pl.purchase_id where p.origin = 'legacy_import';
  select count(*) into v_payments from public.payments pm
    join public.purchases p on p.id = pm.purchase_id where p.origin = 'legacy_import';
  select count(*) into v_paid_rows from public.expense_entries where paid_amount > 0;
  select count(*) into v_unlinked from public.purchases
    where origin = 'legacy_import' and supplier_id is null;

  raise notice 'Copied % expense rows into % purchases, % lines, % payments.',
    v_entries, v_purchases, v_lines, v_payments;
  raise notice 'Suppliers created: %.  Items created: %.', v_new_sup, v_new_item;
  raise notice 'Purchases with no supplier link: % (the source left supplier blank).',
    v_unlinked;

  if v_purchases <> v_entries then
    raise exception 'Purchase count % <> expense row count % — nothing committed.',
      v_purchases, v_entries;
  end if;
  if v_lines <> v_entries then
    raise exception 'Line count % <> expense row count % — nothing committed.',
      v_lines, v_entries;
  end if;
  if v_payments <> v_paid_rows then
    raise exception 'Payment count % <> paid expense row count % — nothing committed.',
      v_payments, v_paid_rows;
  end if;
end $$;

-- ============================================================
-- 9. Self-check — the money must survive the copy, diary and ledger separately
-- ============================================================
do $$
declare
  r        record;
  v_bad    int := 0;
  v_rows   bigint;
  v_tol    numeric;
  v_drift  numeric;
begin
  -- Per row. gross_total is net + round(net × rate/100, 2), so it can differ
  -- from the app's unrounded actual × (1 + rate/100) by at most half a penny.
  -- Anything larger means a column was mapped wrongly.
  select count(*) into v_bad
  from public.purchases p
  join public.expense_entries e on e.id = p.legacy_entry_id
  where p.origin = 'legacy_import'
    and abs(p.gross_total - e.actual_amount * (1 + e.vat_rate / 100)) > 0.005;
  if v_bad > 0 then
    raise exception '% row(s) do not reproduce their incl-VAT total — nothing committed.', v_bad;
  end if;

  -- Per source. Tolerance is the accumulated half-penny rounding, not a
  -- fudge factor: half a penny per row, plus a penny of slack.
  for r in
    select e.source,
           count(*)                                              as row_count,
           sum(e.actual_amount * (1 + e.vat_rate / 100))         as entries_gross,
           sum(e.paid_amount)                                    as entries_paid,
           sum(p.gross_total)                                    as purchases_gross,
           coalesce(sum(pay.paid), 0)                            as purchases_paid
    from public.expense_entries e
    join public.purchases p on p.legacy_entry_id = e.id
    left join lateral (
      select sum(amount) as paid from public.payments where purchase_id = p.id
    ) pay on true
    where p.origin = 'legacy_import'
    group by e.source
  loop
    v_tol := 0.005 * r.row_count + 0.01;
    v_drift := r.purchases_gross - r.entries_gross;
    raise notice '% : % rows | entries %  purchases %  (drift %) | paid %  vs  %',
      r.source, r.row_count,
      round(r.entries_gross, 2), round(r.purchases_gross, 2), round(v_drift, 4),
      round(r.entries_paid, 2), round(r.purchases_paid, 2);
    if abs(v_drift) > v_tol then
      v_bad := v_bad + 1;
      raise warning '% gross total drifted by % (tolerance %)', r.source, round(v_drift, 4), v_tol;
    end if;
    if abs(r.purchases_paid - r.entries_paid) > 0.005 then
      v_bad := v_bad + 1;
      raise warning '% paid total: purchases % <> entries %',
        r.source, r.purchases_paid, r.entries_paid;
    end if;
  end loop;

  if v_bad > 0 then
    raise exception '% total(s) do not match expense_entries — nothing committed.', v_bad;
  end if;

  select count(*) into v_rows from public.expense_entries;
  raise notice 'Backfill checks passed for all % rows.', v_rows;
end $$;

-- ============================================================
-- 10. expenses_view — the bridge back to the old shape
-- ============================================================
-- Shaped like expense_entries so the existing screens could be pointed at it
-- later without changing their code. Nothing reads it yet; it exists so the
-- switchover is reversible.
--
-- security_invoker = true is not optional. A plain view runs with its owner's
-- rights and would hand every user everyone else's rows, because RLS on the
-- base tables is the only thing scoping data in this app. Requires Postgres 15+
-- (Supabase is on 15 or later).
--
-- Two honest differences from expense_entries:
--   • `id` is the purchase id, not the old entry id. `legacy_entry_id` is
--     exposed alongside it so the mapping stays visible.
--   • A purchase with more than one line collapses to a single row: the
--     description is the first line's, and qty/unit_cost report 0 because
--     there is no single answer. Every backfilled purchase has exactly one
--     line, so this is exact for all current data.
create or replace view public.expenses_view
with (security_invoker = true) as
with line_agg as (
  select purchase_id, count(*) as line_count
  from public.purchase_lines
  group by purchase_id
),
pay_agg as (
  select purchase_id,
         sum(amount)                                          as paid_amount,
         min(paid_on)                                         as first_paid_on,
         (array_agg(method order by paid_on nulls last))[1]   as payment_method
  from public.payments
  group by purchase_id
)
select
  p.id,
  p.legacy_entry_id,
  p.user_id,
  p.project_id,
  coalesce(p.week_no, 1)                                      as week_number,
  coalesce(l1.description_raw, '')                            as description,
  p.category,
  p.trade,
  p.location_room,
  p.notes,
  s.name                                                      as supplier,
  p.invoice_no                                                as invoice_ref,
  coalesce(p.purchase_date, pa.first_paid_on)                 as paid_date,
  pa.payment_method,
  coalesce(p.quoted_gross, 0)                                 as quoted_amount,
  p.net_total                                                 as actual_amount,
  coalesce(pa.paid_amount, 0)                                 as paid_amount,
  case when la.line_count = 1 then l1.qty        else 0 end   as qty,
  case when la.line_count = 1 then l1.unit_price else 0 end   as unit_cost,
  case
    when la.line_count = 1 then l1.vat_rate
    when p.net_total > 0   then round(p.vat_total / p.net_total * 100, 2)
    else 0
  end                                                         as vat_rate,
  p.entry_status                                              as status,
  r.storage_path                                              as receipt_url,
  p.entry_source                                              as source,
  p.created_at,
  p.updated_at
from public.purchases p
left join line_agg la on la.purchase_id = p.id
left join lateral (
  select pl.description_raw, pl.qty, pl.unit_price, pl.vat_rate
  from public.purchase_lines pl
  where pl.purchase_id = p.id
  order by pl.line_no
  limit 1
) l1 on true
left join pay_agg pa on pa.purchase_id = p.id
left join public.suppliers s on s.id = p.supplier_id
left join lateral (
  select rc.storage_path
  from public.receipts rc
  where rc.purchase_id = p.id
  order by rc.uploaded_at desc
  limit 1
) r on true;

grant select on public.expenses_view to authenticated;

-- The view must reproduce the table it replaces, or it is not a bridge.
do $$
declare
  v_bad int := 0;
  r     record;
begin
  select count(*) into v_bad
  from public.expense_entries e
  join public.expenses_view v on v.legacy_entry_id = e.id
  where e.description                <> v.description
     or e.week_number                <> v.week_number
     or e.status                     <> v.status
     or e.source                     <> v.source
     or abs(e.actual_amount - v.actual_amount) > 0.005
     or abs(e.paid_amount   - v.paid_amount)   > 0.005
     or abs(e.quoted_amount - v.quoted_amount) > 0.005
     or e.vat_rate                   <> v.vat_rate
     or coalesce(e.paid_date, date '1900-01-01')
        <> coalesce(v.paid_date, date '1900-01-01')
     or coalesce(e.supplier, '')     <> coalesce(v.supplier, '')
     or coalesce(e.category, '')     <> coalesce(v.category, '');

  if v_bad > 0 then
    raise exception 'expenses_view disagrees with expense_entries on % row(s) — nothing committed.', v_bad;
  end if;

  select count(*) into v_bad
  from public.expense_entries e
  left join public.expenses_view v on v.legacy_entry_id = e.id
  where v.id is null;
  if v_bad > 0 then
    raise exception '% expense row(s) are missing from expenses_view — nothing committed.', v_bad;
  end if;

  raise notice 'expenses_view reproduces expense_entries exactly.';
end $$;

commit;
-- rollback;  -- use instead of commit if the numbers look wrong

-- ------------------------------------------------------------------
-- Report. The first two blocks must match about.md §13 and each other.
-- ------------------------------------------------------------------
select 'expense_entries' as source_table,
       e.source          as entry_source,
       count(*)          as row_count,
       round(sum(e.actual_amount * (1 + e.vat_rate / 100)), 2) as gross,
       round(sum(e.paid_amount), 2)                            as paid
from public.expense_entries e
group by e.source
union all
select 'purchases', p.entry_source, count(*),
       round(sum(p.gross_total), 2),
       round(coalesce(sum(pay.paid), 0), 2)
from public.purchases p
left join lateral (
  select sum(amount) as paid from public.payments where purchase_id = p.id
) pay on true
group by p.entry_source
order by 1, 2;

select 'suppliers'        as table_name, count(*) from public.suppliers
union all select 'supplier_aliases', count(*) from public.supplier_aliases
union all select 'items',            count(*) from public.items
union all select 'item_aliases',     count(*) from public.item_aliases
union all select 'purchases',        count(*) from public.purchases
union all select 'purchase_lines',   count(*) from public.purchase_lines
union all select 'payments',         count(*) from public.payments
union all select 'receipts',         count(*) from public.receipts
union all select 'purchases w/o supplier',
                 count(*) from public.purchases where supplier_id is null
order by 1;

-- The Overview cards, recomputed from the new tables. Diary only, cancelled
-- excluded — the same basis as buildSummary (about.md §6.2).
select 'Total Quoted'             as card, round(sum(p.quoted_gross), 2) as value
from public.purchases p where p.entry_source = 'diary' and p.entry_status <> 'Cancelled'
union all
select 'Actual Total (incl. VAT)', round(sum(p.gross_total), 2)
from public.purchases p where p.entry_source = 'diary' and p.entry_status <> 'Cancelled'
union all
select 'Paid to Date', round(sum(pm.amount), 2)
from public.payments pm join public.purchases p on p.id = pm.purchase_id
where p.entry_source = 'diary' and p.entry_status <> 'Cancelled'
union all
select 'Weeks Tracked', count(distinct p.week_no)
from public.purchases p where p.entry_source = 'diary' and p.entry_status <> 'Cancelled';
