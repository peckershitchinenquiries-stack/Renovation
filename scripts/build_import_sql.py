#!/usr/bin/env python3
"""
RenovaTrack — rebuild Supabase data from the two source spreadsheets.

Generates supabase/migrations/0005_reimport_data.sql, which recreates the
project, its expense_entries and trade_lookups under the CURRENT auth user.

Context: the original auth user was deleted. Every table declares
`user_id ... references auth.users(id) on delete cascade`, so the delete
cascaded and removed all rows. Nothing to reassign — this rebuilds from source.

Usage:
    python3 scripts/build_import_sql.py
"""
import re
import datetime as dt
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
USER_ID = "5d3fc9ff-92a3-4923-a18b-7eb5eade3105"  # admin@pk.com, current account
PROJECT_NAME = "46 Glenferrie Road"

FILE1 = ROOT / "46_Glenferrie_Rd_Renovation_Spend_Tracker_Blank_Template.xlsx"
FILE2 = ROOT / "Renovation_Cost_Tracker-1.xlsx"
OUT = ROOT / "supabase" / "migrations" / "0005_reimport_data.sql"

# Values permitted by the CHECK constraints in 0001_init.sql.
CATEGORIES = {"Labour", "Materials", "Skip/Disposal", "Other"}
STATUSES = {"Planned", "In Progress", "Paid", "Cancelled"}
METHODS = {"Cash", "Debit Card", "Credit Card", "Bank Transfer"}


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


def as_date(v):
    """Return an ISO date string, or None if the cell isn't a real date.

    File 1's 'Paid Date' column holds free text like 'Friday 27/2', which the
    `date` column cannot store. Those are preserved in notes instead.
    """
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    return None


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
    """vat_rate is constrained to exactly 0 or 20."""
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
def parse_diary():
    """Week-by-Week Plan -> diary rows (the in-app Expenses tab)."""
    ws = openpyxl.load_workbook(FILE1, data_only=True)["Week-by-Week Plan"]
    rows = list(ws.iter_rows(values_only=True))
    out, skipped_dates = [], 0

    for r in rows[5:]:
        week_raw = r[0]
        # Skip 'Week 1' banner rows and blanks; keep only numeric week cells.
        try:
            week = int(str(week_raw).strip())
        except (TypeError, ValueError):
            continue
        description = (str(r[1]).strip() if r[1] else "")
        if not description:
            continue  # padding row: a week number with no task

        paid_date = as_date(r[8])
        raw_date = r[8]
        if raw_date and not paid_date:
            skipped_dates += 1

        qty = num(r[13])
        unit_cost = num(r[14])
        total = num(r[17])
        if total == 0:
            total = num(r[12]) + num(r[15])  # labour cost + materials cost

        out.append({
            "week": week,
            "description": description,
            "category": category_of(r[2]),
            "trade": (str(r[3]).strip() if r[3] else None),
            "location": (str(r[4]).strip() if r[4] else None),
            # Preserve the unparseable date text rather than losing it.
            "notes": join_notes(
                r[5],
                f"Paid date (as written): {raw_date}" if raw_date and not paid_date else None,
                f"Hours: {num(r[10])}" if num(r[10]) else None,
                f"Rate: {num(r[11])}" if num(r[11]) else None,
            ),
            "supplier": (str(r[6]).strip() if r[6] else None),
            "invoice": (str(r[7]).strip() if r[7] else None),
            "paid_date": paid_date,
            "method": method_of(r[9]),
            "qty": qty,
            "unit_cost": unit_cost,
            "vat": vat_of(r[16]),
            "status": status_of(r[18], 0),
            "quoted": total,
            "actual": total,
            "paid": total if str(r[18] or "").strip() == "Paid" else 0,
            "source": "diary",
        })
    return out, skipped_dates


# ----------------------------------------------------------------- File 2
def parse_ledger():
    """Trades & Labour + Materials & Suppliers -> ledger reference rows."""
    wb = openpyxl.load_workbook(FILE2, data_only=True)
    out = []

    for r in list(wb["Trades & Labour"].iter_rows(values_only=True))[1:]:
        name = (str(r[1]).strip() if r[1] else "")
        quoted, actual, paid = num(r[2]), num(r[3]), num(r[4])
        if not name and quoted == 0 and actual == 0 and paid == 0:
            continue  # trailing formula-only row
        out.append({
            "week": 1, "description": name or "Labour",
            "category": "Labour",
            "trade": (str(r[0]).strip() if r[0] else None),
            "location": None, "notes": join_notes(r[8]),
            "supplier": name or None, "invoice": None,
            "paid_date": as_date(r[5]), "method": None,
            "qty": 0, "unit_cost": 0, "vat": 0,
            "status": status_of(r[7], paid),
            "quoted": quoted, "actual": actual or quoted, "paid": paid,
            "source": "ledger",
        })

    for r in list(wb["Materials & Suppliers"].iter_rows(values_only=True))[1:]:
        item = (str(r[1]).strip() if r[1] else "")
        supplier = (str(r[2]).strip() if r[2] else "")
        total, paid = num(r[5]), num(r[6])
        if not item and not supplier and total == 0 and paid == 0:
            continue
        out.append({
            "week": 1, "description": item or supplier or "Materials",
            "category": "Materials",
            "trade": (str(r[0]).strip() if r[0] else None),
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


# ----------------------------------------------------------------- emit
def main():
    diary, skipped_dates = parse_diary()
    ledger = parse_ledger()
    lookups = parse_lookups()
    entries = diary + ledger

    budget = round(sum(e["quoted"] for e in ledger), 2)
    weeks = sorted({e["week"] for e in diary})

    sql = [
        "-- RenovaTrack — rebuild data after the cascade delete.",
        "-- GENERATED by scripts/build_import_sql.py — do not hand-edit.",
        "--",
        f"-- Owner : {USER_ID} (admin@pk.com)",
        f"-- Diary : {len(diary)} rows, weeks {min(weeks)}-{max(weeks)}",
        f"-- Ledger: {len(ledger)} rows",
        f"-- Trades: {len(lookups)} lookups",
        "--",
        "-- Run in the Supabase SQL editor. Re-runnable: it deletes this",
        "-- user's existing rows for the project first.",
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
        "          'Rebuilt from spreadsheets after auth user deletion.')",
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
        "  raise notice 'Imported project % for user %', v_project, v_user;",
        "end $$;",
        "",
        "-- Verify before committing.",
        "select p.name, p.target_budget,",
        "       count(*) filter (where e.source = 'diary')  as diary_rows,",
        "       count(*) filter (where e.source = 'ledger') as ledger_rows,",
        "       sum(e.actual_amount) as total_actual",
        "from public.projects p",
        "join public.expense_entries e on e.project_id = p.id",
        f"where p.user_id = '{USER_ID}'",
        "group by p.name, p.target_budget;",
        "",
        "commit;",
        "-- rollback;  -- use instead of commit if the numbers look wrong",
        "",
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(sql), encoding="utf-8")

    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  diary  : {len(diary)} rows (weeks {min(weeks)}-{max(weeks)})")
    print(f"  ledger : {len(ledger)} rows")
    print(f"  lookups: {len(lookups)}")
    print(f"  ledger quoted total: {budget}")
    print(f"  diary actual total : {round(sum(e['actual'] for e in diary), 2)}")
    if skipped_dates:
        print(f"  note: {skipped_dates} free-text paid dates moved into notes")


if __name__ == "__main__":
    main()
