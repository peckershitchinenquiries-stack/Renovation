#!/usr/bin/env python3
"""
OBSOLETE — this script no longer does anything, on purpose.

It used to generate supabase/migrations/0006_mark_paid_entries.sql, a follow-up
pass that set status = 'Paid' on the diary rows whose 'Paid Date' column was
filled. build_import_sql.py now does that at import time, so 0006 is redundant.

Worse than redundant: 0006 sets `paid_amount = actual_amount`, and since
0007 actual_amount holds the EX-VAT cost while paid_amount holds the incl-VAT
amount actually handed over, re-running it would quietly knock £166.40 off
'Paid to Date'. So the generator is disabled rather than deleted, and
0006 itself carries a matching do-not-run banner.

If you ever need this behaviour back, take the paid figure from the
'Total incl. VAT' column, not from actual_amount.
"""
import sys

sys.exit(
    "gen_mark_paid_sql.py is obsolete — scripts/build_import_sql.py now sets "
    "the Paid status at import time. See the docstring in this file."
)
