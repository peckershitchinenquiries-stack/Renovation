-- RenovaTrack — initial schema, RLS, indexes, and seed trigger
-- Run in the Supabase SQL editor (or via the Supabase CLI).

-- ============================================================
-- 4.1 projects
-- ============================================================
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  address         text,
  target_budget   numeric(12,2) not null default 0,
  contingency_pct numeric(5,2)  not null default 0,
  start_date      date,
  end_date        date,
  status          text not null default 'active'
                    check (status in ('active','completed','paused')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- 4.3 trade_lookups
-- ============================================================
create table if not exists public.trade_lookups (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  default_rate       numeric(8,2) not null default 0,
  default_markup_pct numeric(5,2) not null default 0,
  created_at         timestamptz not null default now(),
  unique (user_id, name)
);

-- ============================================================
-- 4.2 expense_entries
-- ============================================================
create table if not exists public.expense_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  week_number        integer not null check (week_number > 0),
  description        text not null,
  category           text check (category in ('Labour','Materials','Skip/Disposal','Other')),
  trade              text,
  location_room      text,
  notes              text,
  supplier           text,
  invoice_ref        text,
  paid_date          date,
  payment_method     text check (payment_method is null or payment_method in
                       ('Cash','Debit Card','Credit Card','Bank Transfer')),
  hours              numeric(8,2)  not null default 0 check (hours >= 0),
  labour_rate        numeric(8,2)  not null default 0 check (labour_rate >= 0),
  direct_labour_cost numeric(12,2) not null default 0 check (direct_labour_cost >= 0),
  qty                numeric(10,2) not null default 0 check (qty >= 0),
  unit_cost          numeric(12,2) not null default 0 check (unit_cost >= 0),
  vat_rate           numeric(5,2)  not null default 0 check (vat_rate in (0,20)),
  status             text not null default 'Planned'
                       check (status in ('Planned','In Progress','Paid','Cancelled')),
  receipt_url        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ============================================================
-- 4.4 project_weeks (optional — completion tracking)
-- ============================================================
create table if not exists public.project_weeks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  week_number    integer not null,
  completion_pct numeric(5,2) not null default 0 check (completion_pct between 0 and 100),
  notes          text,
  unique (project_id, week_number)
);

-- ============================================================
-- 4.5 Indexes
-- ============================================================
create index if not exists idx_expense_entries_project_id on public.expense_entries(project_id);
create index if not exists idx_expense_entries_user_id    on public.expense_entries(user_id);
create index if not exists idx_expense_entries_week       on public.expense_entries(project_id, week_number);
create index if not exists idx_expense_entries_status     on public.expense_entries(status);

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_expense_updated on public.expense_entries;
create trigger trg_expense_updated before update on public.expense_entries
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row-Level Security
-- ============================================================
alter table public.projects        enable row level security;
alter table public.expense_entries enable row level security;
alter table public.trade_lookups   enable row level security;
alter table public.project_weeks   enable row level security;

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own expenses" on public.expense_entries;
create policy "own expenses" on public.expense_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own trades" on public.trade_lookups;
create policy "own trades" on public.trade_lookups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own weeks" on public.project_weeks;
create policy "own weeks" on public.project_weeks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Seed default trade lookups on first login (new auth user)
-- ============================================================
create or replace function public.seed_trade_lookups()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
  on conflict (user_id, name) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_trades on auth.users;
create trigger trg_seed_trades after insert on auth.users
  for each row execute function public.seed_trade_lookups();

-- ============================================================
-- Storage bucket for receipts (private)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "own receipts read" on storage.objects;
create policy "own receipts read" on storage.objects
  for select using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own receipts write" on storage.objects;
create policy "own receipts write" on storage.objects
  for insert with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own receipts delete" on storage.objects;
create policy "own receipts delete" on storage.objects
  for delete using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
