-- RenovaTrack — 0011: let a line carry the VAT rate the invoice actually prints.
--
-- The problem this fixes
-- ----------------------
-- `purchase_lines.vat_rate` (0008) and `expense_entries.vat_rate` (0001) both
-- carried `check (vat_rate in (0,20))`. That is not what UK VAT looks like on a
-- residential renovation: the *reduced rate of 5%* applies to a good deal of
-- this kind of work (empty-home renovations, changes to the number of
-- dwellings, some energy-saving materials), and merchants print it on the
-- invoice like any other rate.
--
-- Because the constraint would reject 5, the invoice reader dropped any rate
-- that was not 0 or 20 and the review screen defaulted the field to 0% — so a
-- 5% invoice was silently saved as zero-rated and its VAT vanished from every
-- total. The rate the document prints is now the rate that gets stored.
--
-- What changes
-- ------------
-- Both CHECKs become `in (0,5,20)` — the three rates HMRC currently levies
-- (zero/exempt, reduced, standard). Still a whitelist, not a free number: a
-- typed "200" is a mistake worth rejecting, and the constraint is what catches
-- it (about.md §2 rule 4 — these reject rather than coerce).
--
-- Nothing else moves. Widening a CHECK cannot invalidate an existing row: every
-- row already holds 0 or 20, so no figure in about.md §13 changes.
--
-- Adding another rate later (17.5% for a historic invoice, say) is two edits:
-- this constraint, and VAT_RATES in types/index.ts.
--
-- Prerequisite: 0008 must already have been run.
--
-- Run in the Supabase SQL editor. Re-runnable.

begin;

-- The old constraints were declared inline and so carry Postgres' auto-generated
-- names. Rather than trust those names, drop whatever CHECK on these two tables
-- mentions vat_rate — that is exactly the set we are replacing, and it makes
-- this re-runnable however the constraint came to be named.
do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in (
        'public.expense_entries'::regclass,
        'public.purchase_lines'::regclass
      )
      and pg_get_constraintdef(oid) ilike '%vat_rate%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    raise notice 'dropped % on %', c.conname, c.tbl;
  end loop;
end $$;

alter table public.expense_entries
  add constraint expense_entries_vat_rate_check
  check (vat_rate in (0, 5, 20));

alter table public.purchase_lines
  add constraint purchase_lines_vat_rate_check
  check (vat_rate in (0, 5, 20));

-- Both tables must end up with exactly one vat_rate CHECK, and it must be the
-- new one. A leftover constraint under an unexpected name would still reject 5
-- while looking, from the app's side, as though this migration had worked.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from pg_constraint
  where contype = 'c'
    and conrelid in (
      'public.expense_entries'::regclass,
      'public.purchase_lines'::regclass
    )
    and pg_get_constraintdef(oid) ilike '%vat_rate%'
    and pg_get_constraintdef(oid) not like '%5%';

  if v_bad > 0 then
    raise exception
      '% vat_rate constraint(s) still exclude the reduced rate — nothing committed.',
      v_bad;
  end if;

  raise notice 'vat_rate now accepts 0, 5 and 20 on both tables.';
end $$;

commit;
-- rollback;  -- use instead of commit if anything above raised

-- ------------------------------------------------------------------
-- Report: what rates are actually in use. Expect only 0 and 20 until the
-- first reduced-rate invoice is logged.
-- ------------------------------------------------------------------
select 'purchase_lines' as tbl, vat_rate, count(*)
from public.purchase_lines group by vat_rate
union all
select 'expense_entries', vat_rate, count(*)
from public.expense_entries group by vat_rate
order by 1, 2;
