-- RenovaTrack — 0023: purchase orders
-- (implementation plan, Track B / B3).
--
-- ############################################################
-- ##  STATUS: NOT YET RUN. Paste into the Supabase SQL      ##
-- ##  editor and run it AFTER 0022. Re-runnable.            ##
-- ############################################################
--
-- Why
-- ---
-- `purchases` records a document that has ALREADY BEEN ISSUED TO YOU. There
-- has never been an outbound order: no PO number, no "ordered but not yet
-- delivered" state, no ordered-versus-received quantity, no expected delivery
-- date. `PURCHASE_ORIGINS` covers manual / excel / text / invoice_ocr /
-- legacy_import — none of which is "we raised this order".
--
-- The value is not the paperwork. It is `purchases.purchase_order_id`: once an
-- arriving invoice is matched back to what was ordered, over-delivery and
-- price creep become visible instead of being absorbed. That is where the
-- money actually leaks on a renovation.
--
-- What this is NOT
-- ----------------
-- A PO is not a purchase and does not appear in any spend figure. Nothing in
-- this file feeds Committed, Cost, Paid or Owed, and `purchase_orders` carries
-- no totals column — a PO's value is the sum of its lines, computed on read in
-- lib/purchaseOrders.ts like every other total in this codebase (about.md §2).
-- An order is an intention; only the invoice is money.
--
-- A note the implementation plan got wrong, corrected here
-- --------------------------------------------------------
-- The plan warned that `purchase_lines.vat_rate` still carried
-- `check (vat_rate in (0,20))` and should be widened in this migration.
-- It does not: migration **0011** already widened both `purchase_lines` and
-- `expense_entries` to (0, 5, 20), which is exactly why 0011 exists. There is
-- nothing to fix. The new table below uses the same 0/5/20 set, which was the
-- substance of the warning.

begin;

-- ============================================================
-- 1. purchase_orders — the document you send out
-- ============================================================
create table if not exists public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  -- SET NULL: deleting a supplier must not delete the record of what was
  -- ordered from them. Same reasoning as everywhere else in this schema.
  supplier_id uuid references public.suppliers(id) on delete set null,

  -- Yours, not theirs. Free text because every merchant wants a different
  -- shape and half of them will accept anything. Unique per project so two
  -- orders cannot claim the same number on one job.
  po_number   text,

  raised_on         date not null default current_date,
  expected_delivery date,

  --   draft         — being written, not sent
  --   sent          — with the supplier
  --   part_received — some of it turned up
  --   received      — all of it turned up
  --   cancelled     — never happening
  status      text not null default 'draft'
                check (status in
                  ('draft','sent','part_received','received','cancelled')),

  -- Which piece of work this order is for (0017's join, at document level —
  -- an order is raised for one job, unlike an invoice which can span several).
  task_id     uuid references public.tasks(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists ux_purchase_orders_number
  on public.purchase_orders (project_id, po_number)
  where po_number is not null;
create index if not exists idx_purchase_orders_project
  on public.purchase_orders (project_id, status);
create index if not exists idx_purchase_orders_supplier
  on public.purchase_orders (supplier_id);
create index if not exists idx_purchase_orders_task
  on public.purchase_orders (task_id);
-- "What is due this week and has not arrived?" — the one question a PO list
-- exists to answer.
create index if not exists idx_purchase_orders_due
  on public.purchase_orders (expected_delivery)
  where status in ('sent','part_received');

-- ============================================================
-- 2. purchase_order_lines — ordered vs received
-- ============================================================
-- `qty_received` is the column that earns this table. Without it a PO is a
-- note-to-self; with it, "we ordered 40 and 32 arrived" is a fact the app
-- holds rather than something somebody remembers.
create table if not exists public.purchase_order_lines (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- CASCADE, unlike almost everything else here: a line has no meaning apart
  -- from its order, exactly as purchase_lines has none apart from its invoice.
  po_id        uuid not null references public.purchase_orders(id) on delete cascade,
  line_no      integer not null check (line_no >= 1),

  -- Same optional match to the item register as purchase_lines, so a PO for
  -- "25kg bags of multi-finish" and the invoice for the same thing land on one
  -- price history.
  item_id      uuid references public.items(id) on delete set null,
  description  text not null check (btrim(description) <> ''),

  qty_ordered  numeric(12,3) not null default 0 check (qty_ordered >= 0),
  qty_received numeric(12,3) not null default 0 check (qty_received >= 0),
  unit         text,
  unit_price   numeric(12,4) not null default 0 check (unit_price >= 0),
  -- The same three rates the rest of the app accepts (0011). New money tables
  -- use 0/5/20; a 5% line is ordinary on residential work.
  vat_rate     numeric(5,2) not null default 20 check (vat_rate in (0,5,20)),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Positional, and the order the items appear on the document — same rule as
-- purchase_lines.
create unique index if not exists ux_purchase_order_lines_no
  on public.purchase_order_lines (po_id, line_no);
create index if not exists idx_purchase_order_lines_item
  on public.purchase_order_lines (item_id);

-- Deliberately no `line_net` column and no header totals. qty × unit price is
-- arithmetic, not data, and storing it is how a header comes to disagree with
-- the lines it is made of.

-- ============================================================
-- 3. purchases.purchase_order_id — the match back
-- ============================================================
-- SET NULL: deleting the order must never delete the invoice. An unmatched
-- invoice is a reporting gap; a deleted one is a lost record. Exactly the rule
-- 0017 applied to task_id, and for the same reason.
alter table public.purchases
  add column if not exists purchase_order_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchases_purchase_order_fk'
  ) then
    alter table public.purchases
      add constraint purchases_purchase_order_fk
      foreign key (purchase_order_id)
      references public.purchase_orders(id) on delete set null;
  end if;
end $$;

create index if not exists idx_purchases_purchase_order
  on public.purchases (purchase_order_id)
  where purchase_order_id is not null;

-- ============================================================
-- 4. updated_at triggers
-- ============================================================
drop trigger if exists trg_purchase_orders_updated on public.purchase_orders;
create trigger trg_purchase_orders_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_purchase_order_lines_updated on public.purchase_order_lines;
create trigger trg_purchase_order_lines_updated
  before update on public.purchase_order_lines
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5. RLS and grants — the 0015 shape
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['purchase_orders','purchase_order_lines']
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
  foreach t in array array['purchase_orders','purchase_order_lines']
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
      'Purchase order tables not shared: % — nothing committed.',
      array_to_string(missing, ', ');
  end if;

  raise notice 'Purchase orders ready: 2 tables, shared. No spend figure moves.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. The second query must return 0: nothing is backfilled, so no
-- existing invoice is matched to an order and no total can have changed.
-- ------------------------------------------------------------------
select tablename, policyname, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('purchase_orders','purchase_order_lines')
order by tablename;

select count(*) as invoices_matched_to_an_order
from public.purchases where purchase_order_id is not null;
