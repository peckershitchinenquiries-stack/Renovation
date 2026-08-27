-- RenovaTrack — 0014: give `service_role` table privileges in schema public.
--
-- ############################################################
-- ##  STATUS: RUN — 2026-08-27, by hand in the Supabase     ##
-- ##  SQL editor. Re-runnable if it is ever needed again.    ##
-- ############################################################
--
-- Confirmed live the same day, and not only by the report at the foot of this
-- file: seven `gmail_events` rows were claimed and marked `done` by
-- /api/gmail/drain, which reaches that table through createServiceClient()
-- alone. Before this file ran, that update was a hard 42501 and the route
-- 500'd. (Those seven drains found no invoices, but for an unrelated reason —
-- see the labelAdded gap in about.md §8 and updates.md 2026-08-27.)
--
-- What was wrong
-- --------------
-- Every Gmail route was failing in production, and had been since the day the
-- feature shipped:
--
--   * `GET /api/gmail/drain`  → 500, every five minutes, in cron-job.org
--   * `POST /api/gmail/push`  → 503, on every Pub/Sub delivery and redelivery
--
-- The Vercel log said, in full:
--
--     [api 500] permission denied for table gmail_accounts
--
-- That is Postgres error 42501 — a **GRANT** failure, not an RLS failure. RLS
-- returning nothing looks like an empty result; this is a hard refusal that
-- happens before any policy is consulted.
--
-- The cause: `service_role` had no privileges on **any** table in schema
-- public. Not just the Gmail tables — checking each one with the service key
-- returned 42501 for gmail_accounts, gmail_events, supplier_domains,
-- invoice_uploads, suppliers and expense_entries alike. Supabase normally
-- grants the four built-in roles automatically on table creation via ALTER
-- DEFAULT PRIVILEGES; in this project that never covered `service_role`, and
-- every migration from 0001 onwards granted explicitly to `authenticated`
-- only (0008 line 308, 0010 line 420, 0013 lines 257–259). So the omission was
-- consistent and invisible.
--
-- It was invisible because nothing needed the role until now. Every screen in
-- the app runs as `authenticated` through a user session, and `authenticated`
-- has always had its grants — which is why /items, /invoices and /dashboard
-- were answering 200 in the very same log as the 500s. The only code that uses
-- `service_role` is `createServiceClient()` (lib/supabase/server.ts), and the
-- only places that call it are the three machine-to-machine Gmail routes —
-- the documented R3 exception in about.md §8.4. They have never worked.
--
-- The service key itself was fine and is unchanged: it decodes to
-- {"role":"service_role", "ref":"sdcfmhrecbxjteabtfby"} and is not expired. No
-- environment variable in Vercel needs touching.
--
-- Storage was never affected — the `invoices` bucket answers the service key
-- normally, so attachment upload and download were fine. It is purely the
-- table reads and writes around them that were refused.
--
-- What this changes
-- -----------------
-- Restores the grants a Supabase project is expected to have: `service_role`
-- gets full privileges on the tables, views and sequences in schema public,
-- and a default-privileges rule so tables added later are covered too.
--
-- **No data changes. No policy changes. No schema changes.** Not one row is
-- read, written or deleted by this file, and no figure in about.md §13 moves.
--
-- Is granting the whole schema safe?
-- ----------------------------------
-- Yes, and it is the normal state of a Supabase database. Three reasons:
--
--   1. `service_role` bypasses RLS *by design* — that is what the role is for
--      and what the Gmail routes rely on. Withholding table grants was never
--      acting as a security control; it was simply breaking the feature.
--   2. The key that assumes the role is server-only. It lives in
--      SUPABASE_SERVICE_ROLE_KEY, is never sent to the browser, and is reached
--      only through `createServiceClient()`.
--   3. Granting only the four Gmail tables would fix today's 500 and leave the
--      next service-role read to fail the same silent way. This restores the
--      expected baseline instead of patching one symptom.
--
-- `anon` and `authenticated` are deliberately **not** touched. Their grants are
-- correct, and RLS remains the only thing scoping data under a user session.

begin;

-- The role exists in every Supabase project; this guard is so a paste into a
-- plain Postgres database fails with a sentence rather than a stack trace.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception
      'Role service_role does not exist — is this a Supabase database?';
  end if;
end $$;

-- Schema-level access. Almost certainly already present (the failure was at
-- table level, not schema level, or the error would have named the schema),
-- but it costs nothing to be sure and makes this file complete on its own.
grant usage on schema public to service_role;

-- Existing objects: every table and view, and every sequence.
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Future objects. Without this, the next `create table` in a migration
-- reproduces exactly the bug this file fixes. ALTER DEFAULT PRIVILEGES applies
-- to objects created by the role running it, which for a migration pasted into
-- the SQL editor is the same role that will create them.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant all privileges on functions to service_role;

-- ============================================================
-- Assert the grants actually took
-- ============================================================
-- The four tables the Gmail routes read and write. If any one of them is still
-- refused, the drain 500s again on the next tick and this file has not done
-- its job — so fail here, loudly, rather than there, silently.
do $$
declare
  t text;
  missing text[] := '{}';
begin
  foreach t in array array[
    'gmail_accounts',      -- read by push, drain and watch/renew
    'gmail_events',        -- the durable inbox: written by push, claimed by drain
    'supplier_domains',    -- the extraction gate, read once per drain
    'invoice_uploads'      -- where a drained attachment is filed
  ]
  loop
    if not has_table_privilege('service_role', 'public.' || t, 'select')
    or not has_table_privilege('service_role', 'public.' || t, 'insert')
    or not has_table_privilege('service_role', 'public.' || t, 'update')
    then
      missing := missing || t;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'service_role still cannot use: % — nothing committed.',
      array_to_string(missing, ', ');
  end if;

  raise notice 'service_role now has select/insert/update on all four Gmail tables.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report. Expect every row to read t/t/t/t. Anything showing `f` is a
-- table the service client would still be refused on.
-- ------------------------------------------------------------------
select
  c.relname                                                as table_name,
  has_table_privilege('service_role', c.oid, 'select')     as can_select,
  has_table_privilege('service_role', c.oid, 'insert')     as can_insert,
  has_table_privilege('service_role', c.oid, 'update')     as can_update,
  has_table_privilege('service_role', c.oid, 'delete')     as can_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'v')
order by c.relname;
