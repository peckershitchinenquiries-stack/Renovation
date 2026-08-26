-- RenovaTrack — 0013: Gmail ingestion of supplier invoices (phase 1 of 3).
--
-- ############################################################
-- ##  STATUS: RUN — 2026-08-25, by hand in the Supabase     ##
-- ##  SQL editor. Re-runnable if it is ever needed again.   ##
-- ############################################################
--
-- The report at the foot of this file came back with the three new tables at
-- 0 rows and all 49 existing uploads still reading source_channel = 'manual'
-- (32 committed, 11 extracted, 4 failed, 2 processing) — i.e. nothing already
-- in invoice_uploads changed meaning, which is what this migration promised.
--
-- Why this exists
-- ---------------
-- Invoices arrive by email far more often than they arrive as a photograph.
-- Today every one of them has to be saved out of Gmail and re-uploaded by
-- hand through the nav-bar upload panel. This migration lays the groundwork
-- for reading them straight out of the mailbox instead.
--
-- This is phase 1: storage only. It adds the tables that hold the Google
-- credential, the durable inbox for push notifications, and the declared list
-- of supplier domains, plus the columns on `invoice_uploads` that record where
-- an email-sourced file came from. Nothing in this migration fetches mail —
-- there is no Pub/Sub subscription, no watch registration and no message
-- fetching until phase 2.
--
-- What it changes
-- ---------------
--   * three new tables — gmail_accounts, gmail_events, supplier_domains
--   * eight new nullable columns on invoice_uploads, plus one column with a
--     default ('manual') so every existing row keeps its current meaning
--   * one widened CHECK: invoice_uploads.status gains 'needs_triage'
--
-- Nothing existing changes behaviour. Every new column is nullable or
-- defaulted, so all current rows stay valid and no screen, total or figure in
-- about.md §13 moves.
--
-- Prerequisites: 0008 (public.norm_key, public.suppliers), 0010
-- (invoice_uploads) and 0012 (the committed-has-project constraint) must
-- already have been run.
--
-- Re-runnable.

begin;

-- ============================================================
-- 1. gmail_accounts — the connected mailbox and its credential
-- ============================================================
-- One row per connected Google account per user. Only the *refresh* token is
-- stored: access tokens live for an hour and are minted per request in
-- lib/gmail/auth.ts, so there is nothing here worth stealing that is not
-- already revocable from the Google account page.
--
-- watch_label_id / last_history_id / watch_expiration are all written by
-- phase 2 and are deliberately left null by the connect flow.
create table if not exists public.gmail_accounts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,

  -- Taken from Google's userinfo, never from user input: the address must be
  -- the one that actually consented, or the dedupe below means nothing.
  email_address        text not null,
  refresh_token        text not null,

  -- Phase 2 fields. The Gmail label whose arrivals we watch, and the point in
  -- the mailbox's history we have drained up to.
  watch_label_id       text,
  -- Gmail historyIds are 64-bit and already exceed int4 on busy mailboxes.
  -- Stored as text so this can never silently overflow.
  last_history_id      text,
  watch_expiration     timestamptz,
  last_notification_at timestamptz,
  last_drain_at        timestamptz,

  --   active       — credential works, ingestion may run
  --   needs_reauth — Google returned invalid_grant; the user must reconnect
  --   paused       — the user turned ingestion off deliberately
  status               text not null default 'active'
                         check (status in ('active','needs_reauth','paused')),
  error                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Reconnecting the same mailbox must update the credential in place, not
  -- create a second account row racing the first one.
  unique (user_id, email_address)
);

create index if not exists idx_gmail_accounts_user   on public.gmail_accounts (user_id);
create index if not exists idx_gmail_accounts_status on public.gmail_accounts (status);

drop trigger if exists trg_gmail_accounts_updated on public.gmail_accounts;
create trigger trg_gmail_accounts_updated before update on public.gmail_accounts
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. gmail_events — the durable inbox for push notifications
-- ============================================================
-- Pub/Sub must be acknowledged within seconds, but reading a mailbox and
-- extracting an invoice is not a seconds-long job. So the push endpoint does
-- exactly one thing: write the notification here and ack. A separate drain
-- works the rows off at its own pace, and a crash mid-extraction loses
-- nothing because the row is still sitting at 'pending'.
--
-- Pub/Sub delivery is at-least-once, so the same message_id will arrive more
-- than once. The unique index below is what makes that harmless.
create table if not exists public.gmail_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  account_id       uuid references public.gmail_accounts(id) on delete cascade,

  pubsub_message_id text not null,
  -- Text for the same reason as gmail_accounts.last_history_id.
  history_id       text not null,

  --   pending    — received, not looked at yet
  --   processing — a drain has claimed it
  --   done       — drained; any invoices it carried are in invoice_uploads
  --   failed     — gave up after retries; `error` says why
  status           text not null default 'pending'
                     check (status in ('pending','processing','done','failed')),
  attempts         int not null default 0,
  error            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- The whole point: a redelivered notification collides here and is dropped.
  unique (user_id, pubsub_message_id)
);

-- The drain's only query: oldest pending first.
create index if not exists idx_gmail_events_status_created
  on public.gmail_events (status, created_at);
create index if not exists idx_gmail_events_account on public.gmail_events (account_id);
create index if not exists idx_gmail_events_user    on public.gmail_events (user_id);

drop trigger if exists trg_gmail_events_updated on public.gmail_events;
create trigger trg_gmail_events_updated before update on public.gmail_events
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. supplier_domains — what counts as an invoice worth reading
-- ============================================================
-- A mailbox is mostly not invoices. Rather than guess, ingestion only
-- auto-extracts attachments from senders whose domain the user has declared
-- here. Everything else that looks like an invoice lands as 'needs_triage'
-- for a human to look at, and is never quietly discarded.
--
-- Normalised with public.norm_key — the same rule the supplier and item alias
-- matchers use (about.md §9) — so "Selco.co.uk" and " selco.co.uk " are one
-- domain and not two.
create table if not exists public.supplier_domains (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  domain      text not null check (btrim(domain) <> ''),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One domain maps to at most one supplier per user.
create unique index if not exists ux_supplier_domains_user_domain
  on public.supplier_domains (user_id, public.norm_key(domain));
create index if not exists idx_supplier_domains_supplier
  on public.supplier_domains (supplier_id);

drop trigger if exists trg_supplier_domains_updated on public.supplier_domains;
create trigger trg_supplier_domains_updated before update on public.supplier_domains
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. invoice_uploads — where an email-sourced file came from
-- ============================================================
-- Every column here is nullable, and source_channel defaults to 'manual', so
-- the 30-odd uploads already in the table keep exactly the meaning they have
-- today: a file a human chose and uploaded.
alter table public.invoice_uploads
  add column if not exists gmail_message_id    text,
  add column if not exists gmail_attachment_id text,
  add column if not exists gmail_thread_id     text,
  add column if not exists from_address        text,
  add column if not exists subject             text,
  add column if not exists received_at         timestamptz,
  -- sha256 of the raw attachment bytes, lower-case hex.
  add column if not exists file_hash           text,
  add column if not exists source_channel      text not null default 'manual';

alter table public.invoice_uploads
  drop constraint if exists invoice_uploads_source_channel_check;

alter table public.invoice_uploads
  add constraint invoice_uploads_source_channel_check
  check (source_channel in ('manual','gmail'));

-- The dedupe key. It is the *bytes*, not the message, deliberately: the same
-- invoice PDF routinely arrives twice — forwarded from a colleague, or
-- re-sent by the supplier after a query — and both copies carry different
-- message ids. Hashing the file is the only key that survives that.
-- Partial, so the manual uploads that have no hash do not all collide on null.
create unique index if not exists ux_invoice_uploads_user_hash
  on public.invoice_uploads (user_id, file_hash)
  where file_hash is not null;

-- Second guard, cheaper and earlier: if we have already pulled this exact
-- attachment off this exact message, do not download it again to find out.
create unique index if not exists ux_invoice_uploads_gmail_msg_att
  on public.invoice_uploads (user_id, gmail_message_id, gmail_attachment_id)
  where gmail_message_id is not null;

create index if not exists idx_invoice_uploads_source_channel
  on public.invoice_uploads (source_channel);

-- ------------------------------------------------------------
-- 4b. Widen the status CHECK to add 'needs_triage'
-- ------------------------------------------------------------
-- 'needs_triage' — arrived from Gmail, looks like it might be an invoice, but
-- the sender's domain is not in supplier_domains. It is held for a human
-- rather than extracted automatically or thrown away.
--
-- The constraint was created inline (unnamed) by 0010, so Postgres named it
-- invoice_uploads_status_check. This drops that exact constraint and puts it
-- back with the five original values plus the new one — nothing else about it
-- changes. invoice_uploads_committed_has_project (0012) is untouched.
alter table public.invoice_uploads
  drop constraint if exists invoice_uploads_status_check;

alter table public.invoice_uploads
  add constraint invoice_uploads_status_check
  check (status in ('pending','processing','extracted','failed','committed','needs_triage'));

-- ============================================================
-- 5. Row-Level Security and grants
-- ============================================================
-- A new table with RLS enabled and no policy returns nothing; with RLS left
-- disabled it leaks everything. Both failure modes are silent (about.md §2).
-- No query in this app filters by user_id — these policies are the only thing
-- scoping the data.
alter table public.gmail_accounts   enable row level security;
alter table public.gmail_events     enable row level security;
alter table public.supplier_domains enable row level security;

drop policy if exists "own gmail accounts" on public.gmail_accounts;
create policy "own gmail accounts" on public.gmail_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own gmail events" on public.gmail_events;
create policy "own gmail events" on public.gmail_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own supplier domains" on public.supplier_domains;
create policy "own supplier domains" on public.supplier_domains
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.gmail_accounts   to authenticated;
grant select, insert, update, delete on public.gmail_events     to authenticated;
grant select, insert, update, delete on public.supplier_domains to authenticated;

-- ============================================================
-- 6. Assert the widened CHECK actually took
-- ============================================================
-- If this file is pasted into the wrong database, or 0010 was never run, the
-- ALTERs above can look like a success and the app would then 500 on the
-- first triaged invoice instead. Fail loudly here rather than there.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.invoice_uploads'::regclass
    and conname = 'invoice_uploads_status_check';

  if v_def is null or v_def not like '%needs_triage%' then
    raise exception
      'invoice_uploads_status_check does not allow needs_triage — nothing committed.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_uploads'::regclass
      and conname = 'invoice_uploads_committed_has_project'
  ) then
    raise exception
      'invoice_uploads_committed_has_project is missing — run 0012 first.';
  end if;

  raise notice 'invoice_uploads.status now allows needs_triage.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Expect: three tables with 0 rows, and every existing upload
-- showing source_channel = 'manual'.
-- ------------------------------------------------------------------
select 'gmail_accounts'   as table_name, count(*) from public.gmail_accounts
union all
select 'gmail_events',      count(*) from public.gmail_events
union all
select 'supplier_domains',  count(*) from public.supplier_domains;

select source_channel, status, count(*)
from public.invoice_uploads
group by source_channel, status
order by source_channel, status;
