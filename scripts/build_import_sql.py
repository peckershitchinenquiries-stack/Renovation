#!/usr/bin/env python3
"""
RenovaTrack — rebuild the Supabase data from the source spreadsheets.

Generates supabase/migrations/0007_reimport_weeks_1_23.sql, which recreates the
project, its expense_entries and its trade_lookups under the CURRENT auth user.

Two source files:
  File 1  46_Glenferrie_Rd_Renovation_Spend_Tracker_Updated.xlsx
          'Week-by-Week Plan' -> 111 diary rows, weeks 1-23
  File 2  Renovation_Cost_Tracker-1.xlsx
          'Trades & Labour' + 'Materials & Suppliers' -> 96 ledger rows

HOW MONEY IS MAPPED  (read this before changing anything)
--------------------------------------------------------
The app never stores a total. `computeEntry` in lib/calculations.ts derives

    total_incl_vat = actual_amount x (1 + vat_rate / 100)

on every read. So `actual_amount` MUST hold the EX-VAT figure, or VAT gets
applied twice. The earlier import stored the sheet's 'Total incl. VAT (£)'
column in actual_amount *and* set vat_rate to 20, which is exactly what made
the app show £43,686.17 where the spreadsheet said £42,411.81.

    actual_amount  <- 'Labour Cost (£)' + 'Materials Cost (£)'   (ex-VAT)
    vat_rate       <- 'VAT'  ('0%' -> 0, '20%' -> 20)
    quoted_amount  <- 'Total incl. VAT (£)'
    paid_amount    <- 'Total incl. VAT (£)' when a Paid Date is filled, else 0
    status         <- 'Paid' when a Paid Date is filled, else the sheet's Status

`quoted_amount` gets the incl-VAT total because the Week-by-Week Plan has no
quote column at all — the sheet's forecast IS its quote. That makes the
Overview 'Total Quoted' card agree with the sheet's 'Forecast Total (incl.
VAT)' and leaves 'Variance vs Quote' at £0.

`paid_amount` gets the incl-VAT total because that is what was actually handed
over, and it makes 'Paid to Date' and 'Remaining to Pay' agree with the sheet's
own Payment Status block to the penny.

Every row is checked against the sheet's own arithmetic before it is emitted
(see check_arithmetic), and the generated SQL re-checks every week total
against the Summary sheet before it commits.

Usage:
    python scripts/build_import_sql.py
"""
import re
import datetime as dt
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
USER_ID = "5d3fc9ff-92a3-4923-a18b-7eb5eade3105"  # admin@pk.com, current account
PROJECT_NAME = "46 Glenferrie Road"

FILE1 = ROOT / "46_Glenferrie_Rd_Renovation_Spend_Tracker_Updated.xlsx"
FILE2 = ROOT / "Renovation_Cost_Tracker-1.xlsx"
OUT = ROOT / "supabase" / "migrations" / "0007_reimport_weeks_1_23.sql"

# Column indexes into 'Week-by-Week Plan' (0-based, header on sheet row 5).
C_WEEK, C_DESC, C_CAT, C_TRADE, C_ROOM = 0, 1, 2, 3, 4
C_NOTES, C_SUPPLIER, C_INVOICE, C_PAIDDATE, C_METHOD = 5, 6, 7, 8, 9
C_HOURS, C_RATE, C_LABOUR = 10, 11, 12
C_QTY, C_UNIT, C_MATERIALS = 13, 14, 15
C_VAT, C_TOTAL, C_STATUS = 16, 17, 18

# Values permitted by the CHECK constraints in 0001_init.sql.
CATEGORIES = {"Labour", "Materials", "Skip/Disposal", "Other"}
STATUSES = {"Planned", "In Progress", "Paid", "Cancelled"}
METHODS = {"Cash", "Debit Card", "Credit Card", "Bank Transfer"}

PENNY = 0.011  # tolerance for float comparisons against the sheet


# ----------------------------------------------------------------- helpers
def q(v):
    """Quote a value as a SQL literal."""
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def num(v, default=0):
    """Coerce a spreadsheet cell to a number, tolerating '£1,234.50' text."""
    if v is None or v == "":
        return default
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    s = re.sub(r"[^0-9.\-]", "", str(v))
    try:
        return round(float(s), 2)
    except ValueError:
        return default


def text(v):
    """Trimmed cell text, or None when the cell is empty."""
    s = str(v).strip() if v is not None else ""
    return s or None


WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}
# Candidate years for resolving free-text paid dates, most likely first.
YEAR_CANDIDATES = (2026, 2025, 2027)


def as_date(v):
    """Return an ISO date string, or None if the cell isn't a real date."""
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    return None


def resolve_written_date(v):
    """Resolve free text like 'Friday 27/2' to a real ISO date.

    File 1's 'Paid Date' column is hand-typed day/month with a weekday name and
    no year. The weekday disambiguates the year: only 2026 puts every one of
    these dates on the stated weekday. Returns None if it can't be resolved,
    in which case the raw text is kept in notes as before.
    """
    if isinstance(v, (dt.datetime, dt.date)):
        return None  # already a real date; as_date handles it
    s = str(v or "").strip()
    if not s:
        return None
    m = re.search(r"(\d{1,2})\s*/\s*(\d{1,2})", s)
    if not m:
        return None
    day, month = int(m.group(1)), int(m.group(2))
    named = next((n for n in WEEKDAYS if n in s.lower()), None)

    fallback = None
    for year in YEAR_CANDIDATES:
        try:
            cand = dt.date(year, month, day)
        except ValueError:
            continue
        if named is None:
            return cand.strftime("%Y-%m-%d")
        if cand.weekday() == WEEKDAYS[named]:
            return cand.strftime("%Y-%m-%d")
        fallback = fallback or cand
    # Weekday never matched — trust the day/month over the weekday name.
    return fallback.strftime("%Y-%m-%d") if fallback else None


def category_of(v):
    v = (str(v).strip() if v else "")
    return v if v in CATEGORIES else ("Other" if v else None)


def status_of(v, paid):
    """Map a spreadsheet status to the CHECK-constrained set."""
    s = str(v or "").strip()
    if "Cancel" in s:
        return "Cancelled"
    if "Progress" in s:
        return "In Progress"
    if paid > 0:
        return "Paid"
    if s in STATUSES:
        return s
    return "Planned"


def method_of(v):
    s = str(v or "").strip()
    if not s:
        return None
    low = s.lower()
    if "cash" in low:
        return "Cash"
    if "credit" in low:
        return "Credit Card"
    if "debit" in low:
        return "Debit Card"
    if "bank" in low or "transfer" in low or low.startswith("bt"):
        return "Bank Transfer"
    return None


def vat_of(v):
    """vat_rate is constrained to exactly 0 or 20.

    The updated sheet writes this column as text ('0%' / '20%'); the older one
    wrote it as a number. num() strips the '%' either way.
    """
    n = num(v)
    if n in (0, 20):
        return int(n)
    return 20 if n > 0 else 0


def join_notes(*parts):
    out = [str(p).strip() for p in parts if p not in (None, "")]
    return " | ".join(out) if out else None


COLS = (
    "user_id, project_id, week_number, description, category, trade, "
    "location_room, notes, supplier, invoice_ref, paid_date, payment_method, "
    "qty, unit_cost, vat_rate, status, quoted_amount, actual_amount, "
    "paid_amount, source"
)


def row_sql(r):
    return (
        "  ("
        f"v_user, v_project, {r['week']}, {q(r['description'])}, "
        f"{q(r['category'])}, {q(r['trade'])}, {q(r['location'])}, "
        f"{q(r['notes'])}, {q(r['supplier'])}, {q(r['invoice'])}, "
        f"{q(r['paid_date'])}{'::date' if r['paid_date'] else ''}, "
        f"{q(r['method'])}, {r['qty']}, {r['unit_cost']}, {r['vat']}, "
        f"{q(r['status'])}, {r['quoted']}, {r['actual']}, {r['paid']}, "
        f"{q(r['source'])})"
    )


# ----------------------------------------------------------------- File 1
def diary_sheet():
    return openpyxl.load_workbook(FILE1, data_only=True)["Week-by-Week Plan"]


def parse_diary():
    """Week-by-Week Plan -> diary rows (the in-app Expenses tab).

    Returns (rows, warnings). A row is real when the week cell is a number AND
    the description is non-empty; everything else is a 'Week n' banner or one
    of the blank padding rows the template ships with.
    """
    rows = list(diary_sheet().iter_rows(values_only=True))
    out, warnings = [], []

    for excel_row, r in enumerate(rows[5:], start=6):
        try:
            week = int(str(r[C_WEEK]).strip())
        except (TypeError, ValueError):
            continue  # 'Week 1' banner, or blank
        description = text(r[C_DESC])
        if not description:
            continue  # padding row: a week number with no task

        raw_date = r[C_PAIDDATE]
        # A filled 'Paid Date' is what marks a row as paid — the sheet's Status
        # column reads 'Planned' on every row and carries no payment signal.
        paid_date = as_date(raw_date) or resolve_written_date(raw_date)
        if raw_date and not paid_date:
            warnings.append(
                f"row {excel_row} (week {week}, {description!r}): could not read "
                f"paid date {raw_date!r} — kept as text in notes"
            )
        is_paid = bool(paid_date)

        # Ex-VAT cost. The sheet splits it across two columns; a Materials row
        # carries its money in 'Materials Cost', a Labour row in 'Labour Cost'.
        # Weeks 20-23 were typed with everything in the Materials column, which
        # is why we add the pair rather than choosing one by category.
        ex_vat = round(num(r[C_LABOUR]) + num(r[C_MATERIALS]), 2)
        vat = vat_of(r[C_VAT])
        sheet_total = num(r[C_TOTAL])

        out.append({
            "week": week,
            "excel_row": excel_row,
            "description": description,
            "category": category_of(r[C_CAT]),
            "trade": text(r[C_TRADE]),
            "location": text(r[C_ROOM]),
            # Preserve the unparseable date text rather than losing it.
            "notes": join_notes(
                r[C_NOTES],
                f"Paid date (as written): {raw_date}" if raw_date and not paid_date else None,
                f"Hours: {num(r[C_HOURS])}" if num(r[C_HOURS]) else None,
                f"Rate: {num(r[C_RATE])}" if num(r[C_RATE]) else None,
            ),
            "supplier": text(r[C_SUPPLIER]),
            "invoice": text(r[C_INVOICE]),
            "paid_date": paid_date,
            "method": method_of(r[C_METHOD]),
            "qty": num(r[C_QTY]),
            "unit_cost": num(r[C_UNIT]),
            "vat": vat,
            "status": status_of(r[C_STATUS], sheet_total if is_paid else 0),
            # See the module docstring for why each amount is what it is.
            "quoted": sheet_total,
            "actual": ex_vat,
            "paid": sheet_total if is_paid else 0,
            "sheet_total": sheet_total,
            "source": "diary",
        })
    return out, warnings


def check_arithmetic(diary):
    """Verify actual x (1 + vat) reproduces the sheet's own Total column.

    If this ever fails, the row's Labour/Materials/VAT/Total cells disagree with
    each other in the spreadsheet and the import would silently invent a number.
    """
    bad = []
    for r in diary:
        expect = round(r["actual"] * (1 + r["vat"] / 100), 2)
        if abs(expect - r["sheet_total"]) > PENNY:
            bad.append(
                f"row {r['excel_row']} (week {r['week']}, {r['description']!r}): "
                f"ex-VAT {r['actual']} + {r['vat']}% = {expect} but the sheet's "
                f"Total column says {r['sheet_total']}"
            )
    return bad


def parse_week_summary():
    """The Summary sheet's 'By Week (Totals)' block -> {week: total incl VAT}.

    Used as the independent expected value in the generated migration's own
    self-check, so the SQL proves itself against the spreadsheet.
    """
    ws = openpyxl.load_workbook(FILE1, data_only=True)["Summary"]
    out = {}
    for r in ws.iter_rows(values_only=True):
        if isinstance(r[0], (int, float)) and r[3] is not None:
            out[int(r[0])] = round(float(r[3]), 2)
    return out


# ----------------------------------------------------------------- File 2
def parse_ledger():
    """Trades & Labour + Materials & Suppliers -> ledger reference rows.

    These are a second, overlapping record of the same job. They are shown only
    on the Trades and Materials tabs and are excluded from every project total —
    see about.md section 5. Unchanged by the weeks 16-23 update.
    """
    wb = openpyxl.load_workbook(FILE2, data_only=True)
    out = []

    for r in list(wb["Trades & Labour"].iter_rows(values_only=True))[1:]:
        name = text(r[1]) or ""
        quoted, actual, paid = num(r[2]), num(r[3]), num(r[4])
        if not name and quoted == 0 and actual == 0 and paid == 0:
            continue  # trailing formula-only row
        out.append({
            "week": 1, "description": name or "Labour",
            "category": "Labour",
            "trade": text(r[0]),
            "location": None, "notes": join_notes(r[8]),
            "supplier": name or None, "invoice": None,
            "paid_date": as_date(r[5]), "method": None,
            "qty": 0, "unit_cost": 0, "vat": 0,
            "status": status_of(r[7], paid),
            "quoted": quoted, "actual": actual or quoted, "paid": paid,
            "source": "ledger",
        })

    for r in list(wb["Materials & Suppliers"].iter_rows(values_only=True))[1:]:
        item = text(r[1]) or ""
        supplier = text(r[2]) or ""
        total, paid = num(r[5]), num(r[6])
        if not item and not supplier and total == 0 and paid == 0:
            continue
        out.append({
            "week": 1, "description": item or supplier or "Materials",
            "category": "Materials",
            "trade": text(r[0]),
            "location": None, "notes": join_notes(r[8]),
            "supplier": supplier or None, "invoice": None,
            "paid_date": as_date(r[7]), "method": method_of(r[8]),
            "qty": num(r[4]), "unit_cost": num(r[3]), "vat": 0,
            "status": "Paid" if paid > 0 else "Planned",
            "quoted": total, "actual": total, "paid": paid,
            "source": "ledger",
        })
    return out


# ----------------------------------------------------------------- lookups
def parse_lookups():
    ws = openpyxl.load_workbook(FILE1, data_only=True)["Lookups"]
    out = []
    for r in list(ws.iter_rows(values_only=True))[1:]:
        if not r[0]:
            continue
        out.append((str(r[0]).strip(), num(r[1]), num(r[2])))
    return out


# ----------------------------------------------------------------- report
def app_figures(diary):
    """Recompute the Overview cards exactly as lib/summary.ts would.

    Kept in step with buildSummary(): quoted and paid are summed straight from
    the stored columns, the total is derived as actual x (1 + vat/100), and
    cancelled rows are excluded.
    """
    active = [r for r in diary if r["status"] != "Cancelled"]
    total_quoted = sum(r["quoted"] for r in active)
    forecast = sum(r["actual"] * (1 + r["vat"] / 100) for r in active)
    paid = sum(r["paid"] for r in active)
    return {
        "total_quoted": round(total_quoted, 2),
        "forecast_total": round(forecast, 2),
        "variance": round(forecast - total_quoted, 2),
        "paid_to_date": round(paid, 2),
        "remaining_to_pay": round(forecast - paid, 2),
        "weeks_tracked": len({r["week"] for r in active}),
    }


def print_week_report(diary, sheet_weeks):
    """Week-by-week: what the app will show vs what the spreadsheet says."""
    by_week = {}
    for r in diary:
        if r["status"] == "Cancelled":
            continue
        b = by_week.setdefault(r["week"], {"labour": 0.0, "materials": 0.0, "total": 0.0, "n": 0})
        incl = r["actual"] * (1 + r["vat"] / 100)
        if r["category"] == "Materials":
            b["materials"] += incl
        else:
            b["labour"] += incl
        b["total"] += incl
        b["n"] += 1

    print("\n  week  rows       app total     sheet total        diff")
    print("  " + "-" * 56)
    worst = 0.0
    for w in sorted(by_week):
        app = by_week[w]["total"]
        sheet = sheet_weeks.get(w, 0.0)
        diff = app - sheet
        worst = max(worst, abs(diff))
        flag = "" if abs(diff) <= PENNY else "   <-- MISMATCH"
        print(f"  {w:>4}  {by_week[w]['n']:>4}  {app:>14,.2f}  {sheet:>14,.2f}  {diff:>10.3f}{flag}")
    print(f"  worst week difference: £{worst:.4f}")
    return by_week


# ----------------------------------------------------------------- emit
def main():
    diary, warnings = parse_diary()
    sheet_weeks = parse_week_summary()

    problems = check_arithmetic(diary)
    if problems:
        print("ABORT — the spreadsheet's own arithmetic does not add up:")
        for p in problems:
            print("  " + p)
        raise SystemExit(1)

    ledger = parse_ledger()
    lookups = parse_lookups()
    entries = diary + ledger

    budget = round(sum(e["quoted"] for e in ledger), 2)
    weeks = sorted({e["week"] for e in diary})
    fig = app_figures(diary)

    # Only weeks that actually carry rows are worth checking; the sheet lists
    # empty weeks up to 32.
    expected_weeks = [(w, sheet_weeks[w]) for w in weeks if w in sheet_weeks]

    sql = [
        "-- RenovaTrack — reimport the Week-by-Week Plan, now covering weeks 1-23.",
        "-- GENERATED by scripts/build_import_sql.py — do not hand-edit.",
        "--",
        f"-- Owner  : {USER_ID} (admin@pk.com)",
        f"-- Diary  : {len(diary)} rows, weeks {min(weeks)}-{max(weeks)}  (File 1, 'Week-by-Week Plan')",
        f"-- Ledger : {len(ledger)} rows                (File 2, unchanged)",
        f"-- Trades : {len(lookups)} lookups",
        "--",
        "-- Supersedes 0005 (weeks 1-15) and 0006 (mark-paid). Do NOT run those",
        "-- again — this file rebuilds the project from scratch and already sets",
        "-- the Paid status on every row that has a paid date.",
        "--",
        "-- Money mapping — actual_amount is EX-VAT because the app derives",
        "--   total_incl_vat = actual_amount x (1 + vat_rate/100)",
        "-- on every read (lib/calculations.ts). Storing an incl-VAT figure here",
        "-- is what made the old import show VAT twice.",
        "--   actual_amount = Labour Cost + Materials Cost   (ex-VAT)",
        "--   quoted_amount = Total incl. VAT                (the sheet's forecast)",
        "--   paid_amount   = Total incl. VAT, when a Paid Date is filled",
        "--",
        "-- After this runs the Overview tab should read:",
        f"--   Total Quoted      £{fig['total_quoted']:,.2f}",
        f"--   Actual Total      £{fig['forecast_total']:,.2f}   (= the sheet's Forecast Total)",
        f"--   Variance vs Quote £{fig['variance']:,.2f}",
        f"--   Paid to Date      £{fig['paid_to_date']:,.2f}   (= the sheet's 'Paid to date')",
        f"--   Remaining to Pay  £{fig['remaining_to_pay']:,.2f}  (= the sheet's 'Committed')",
        f"--   Weeks Tracked     {fig['weeks_tracked']}",
        "--",
        "-- Run in the Supabase SQL editor. Re-runnable: it deletes this user's",
        "-- existing copy of the project first. It refuses to commit if any week",
        "-- total disagrees with the spreadsheet.",
        "",
        "begin;",
        "",
        "do $$",
        "declare",
        f"  v_user    uuid := '{USER_ID}';",
        "  v_project uuid;",
        "begin",
        "  if not exists (select 1 from auth.users where id = v_user) then",
        "    raise exception 'User % not found in auth.users.', v_user;",
        "  end if;",
        "",
        "  -- Idempotency: clear any prior import of this project.",
        f"  delete from public.projects where user_id = v_user and name = {q(PROJECT_NAME)};",
        "",
        "  insert into public.projects (user_id, name, target_budget, status, notes)",
        f"  values (v_user, {q(PROJECT_NAME)}, {budget}, 'active',",
        f"          'Imported from the Week-by-Week Plan, weeks 1-{max(weeks)}.')",
        "  returning id into v_project;",
        "",
        f"  insert into public.expense_entries ({COLS}) values",
    ]
    sql.append(",\n".join(row_sql(r) for r in entries) + ";")
    sql += ["", "  insert into public.trade_lookups (user_id, name, default_rate, default_markup_pct) values"]
    sql.append(
        ",\n".join(f"  (v_user, {q(n)}, {rate}, {mk})" for n, rate, mk in lookups)
        + "\n  on conflict (user_id, name) do update"
        + "\n    set default_rate = excluded.default_rate,"
        + "\n        default_markup_pct = excluded.default_markup_pct;"
    )
    sql += [
        "",
        "  insert into public.project_weeks (user_id, project_id, week_number, completion_pct)",
        f"  select v_user, v_project, generate_series(1, {max(weeks)}), 0",
        "  on conflict (project_id, week_number) do nothing;",
        "",
        f"  raise notice 'Imported project % ({len(diary)} diary + {len(ledger)} ledger rows).', v_project;",
        "end $$;",
        "",
        "-- ------------------------------------------------------------------",
        "-- Self-check: every week's diary total must equal the spreadsheet's",
        "-- 'Summary' -> 'By Week (Totals)' figure. Any disagreement aborts the",
        "-- transaction, so a bad import can never be committed by accident.",
        "-- ------------------------------------------------------------------",
        "do $$",
        "declare",
        f"  v_user  uuid := '{USER_ID}';",
        "  r       record;",
        "  v_bad   int := 0;",
        "begin",
        "  for r in",
        "    with expected(week_number, sheet_total) as (values",
    ]
    sql.append(
        ",\n".join(f"      ({w}, {t}::numeric)" for w, t in expected_weeks)
        + "\n    ),"
    )
    sql += [
        "    got as (",
        "      select e.week_number,",
        "             sum(e.actual_amount * (1 + e.vat_rate / 100)) as app_total",
        "      from public.expense_entries e",
        "      join public.projects p on p.id = e.project_id",
        "      where p.user_id = v_user",
        f"        and p.name   = {q(PROJECT_NAME)}",
        "        and e.source = 'diary'",
        "        and e.status <> 'Cancelled'",
        "      group by e.week_number",
        "    )",
        "    select expected.week_number, expected.sheet_total,",
        "           coalesce(got.app_total, 0) as app_total",
        "    from expected left join got using (week_number)",
        "    order by expected.week_number",
        "  loop",
        "    if abs(r.app_total - r.sheet_total) > 0.01 then",
        "      v_bad := v_bad + 1;",
        "      raise warning 'Week %: app % <> spreadsheet %',",
        "        r.week_number, round(r.app_total, 2), r.sheet_total;",
        "    end if;",
        "  end loop;",
        "",
        "  if v_bad > 0 then",
        "    raise exception '% week(s) do not match the spreadsheet — nothing committed.', v_bad;",
        "  end if;",
        f"  raise notice 'All {len(expected_weeks)} weeks match the spreadsheet.';",
        "end $$;",
        "",
        "commit;",
        "-- rollback;  -- use instead of commit if the numbers look wrong",
        "",
        "-- ------------------------------------------------------------------",
        "-- Report. Compare these against the spreadsheet's Summary tab.",
        "-- ------------------------------------------------------------------",
        "select 'Total Quoted'      as card, sum(quoted_amount)                          as value",
        "from public.expense_entries e join public.projects p on p.id = e.project_id",
        f"where p.user_id = '{USER_ID}' and p.name = {q(PROJECT_NAME)}",
        "  and e.source = 'diary' and e.status <> 'Cancelled'",
        "union all",
        "select 'Actual Total (incl. VAT)', sum(actual_amount * (1 + vat_rate / 100))",
        "from public.expense_entries e join public.projects p on p.id = e.project_id",
        f"where p.user_id = '{USER_ID}' and p.name = {q(PROJECT_NAME)}",
        "  and e.source = 'diary' and e.status <> 'Cancelled'",
        "union all",
        "select 'Paid to Date', sum(paid_amount)",
        "from public.expense_entries e join public.projects p on p.id = e.project_id",
        f"where p.user_id = '{USER_ID}' and p.name = {q(PROJECT_NAME)}",
        "  and e.source = 'diary' and e.status <> 'Cancelled'",
        "union all",
        "select 'Weeks Tracked', count(distinct week_number)",
        "from public.expense_entries e join public.projects p on p.id = e.project_id",
        f"where p.user_id = '{USER_ID}' and p.name = {q(PROJECT_NAME)}",
        "  and e.source = 'diary' and e.status <> 'Cancelled'",
        "union all",
        "select 'Diary rows', count(*)",
        "from public.expense_entries e join public.projects p on p.id = e.project_id",
        f"where p.user_id = '{USER_ID}' and p.name = {q(PROJECT_NAME)} and e.source = 'diary'",
        "union all",
        "select 'Ledger rows', count(*)",
        "from public.expense_entries e join public.projects p on p.id = e.project_id",
        f"where p.user_id = '{USER_ID}' and p.name = {q(PROJECT_NAME)} and e.source = 'ledger';",
        "",
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(sql), encoding="utf-8")

    # ------------------------------------------------------------- summary
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  source : {FILE1.name}")
    print(f"  diary  : {len(diary)} rows (weeks {min(weeks)}-{max(weeks)})")
    print(f"  ledger : {len(ledger)} rows")
    print(f"  lookups: {len(lookups)}")
    print(f"  paid   : {sum(1 for r in diary if r['paid'] > 0)} rows")
    print("  every row's ex-VAT + VAT reproduces the sheet's Total column")

    print("\nOverview cards this import will produce:")
    print(f"  Target Budget      £{budget:,.2f}   (File 2 ledger quoted — unchanged)")
    print(f"  Total Quoted       £{fig['total_quoted']:,.2f}")
    print(f"  Actual Total       £{fig['forecast_total']:,.2f}")
    print(f"  Variance vs Quote  £{fig['variance']:,.2f}")
    print(f"  Paid to Date       £{fig['paid_to_date']:,.2f}")
    print(f"  Remaining to Pay   £{fig['remaining_to_pay']:,.2f}")
    print(f"  Weeks Tracked      {fig['weeks_tracked']}")

    print_week_report(diary, sheet_weeks)

    for w in warnings:
        print(f"  note: {w}")


if __name__ == "__main__":
    main()
