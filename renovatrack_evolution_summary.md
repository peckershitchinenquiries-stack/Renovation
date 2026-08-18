# RenovaTrack Evolution — Project Status & Implementation Plan

## Current Project Status

**What exists:** RenovaTrack is a single-project renovation cost tracker built in Next.js deployed on Vercel at `https://renovation-theta.vercel.app/`. The Glenferrie Road (St Albans) project is nearly complete.

**Current data model:** One expense = one row. Each entry contains:
- Week number, description (free text), category, trade (free text)
- Quoted amount, actual cost, paid amount
- VAT flag
- Status tracking (Paid / Partial / Pending)

**Current capabilities:**
- Weekly spending chart and budget overview
- Material vs labour breakdown
- Running total against budget
- Basic price warnings ("price higher than last time")
- Expense entry form with duplicate detection
- Trade/Supplier grouping (via text match on `trade` field)
- Materials & Suppliers tab (grouped by supplier name)
- Price tracker (flags same item at higher unit price)
- Receipts/photo attachment per entry

---

## Core Limitations Identified

### 1. **Materials and suppliers exist only as typed text**
- No canonical records for suppliers or materials
- "Sand", "sand ", "Building Sand" are treated as three different items
- "Lawson", "Lawsons", "Lawson Bldg Supplies" are treated as three different suppliers
- Grouping by supplier is unreliable string matching
- Price comparisons are impossible to trust (no way to normalize units or pack sizes)

### 2. **One expense row = one item (no support for multi-line invoices)**
- Real invoices contain 3–8 items per document (nails, plaster, planks, gum, etc.)
- Current structure forces one row per item, losing the document context
- No way to know that nails, plaster, and planks all came on the same invoice on the same date
- Makes invoice upload/ingestion half-pointless

### 3. **Thin payment detail**
- `paid` is a single number (amount), no date or method attached
- Balance is stored, not calculated
- Cannot reconstruct a supplier account statement ("what did I owe Lawson on 14 Aug?")
- No payment method tracking (cash, card, bank transfer, account credit)

### 4. **Data enters only by manual typing**
- Bulk history (old spreadsheets) cannot be reliably imported
- Invoices and receipts stay outside the system
- No way to extract invoice text (supplier, date, lines, totals)
- Messy data stays messy (TASK vs Notes columns in original spreadsheet)

---

## Root Cause

All four limitations trace to one architecture: **the expense table flattens both the document and the items, and both the purchase and the payment.**

The data shape doesn't match how invoices and accounts actually work, so anything built on top of it fights reality.

---

## Recommended Solution: Route C (Restructure the Transaction Core)

### New Data Entities (Schema outline)

**Global scope (shared across all projects):**
```
suppliers          id, name, type, account_ref, notes
supplier_aliases   id, supplier_id, alias
items              id, canonical_name, category, default_unit, pack_size, pack_unit
item_aliases       id, item_id, alias
```

**Per-project scope:**
```
projects           id, name, address, budget, status
purchases          id, project_id, supplier_id, purchase_date, week_no,
                   invoice_no, category, net_total, vat_total, gross_total,
                   source (manual|excel|text|invoice_ocr), source_file_id
purchase_lines     id, purchase_id, item_id, description_raw,
                   qty, unit, unit_price, line_net, vat_rate
payments           id, purchase_id, paid_on, amount, method, reference
receipts           id, purchase_id, storage_path, uploaded_at
```

### Key Principles

1. **Balance is calculated, never stored.**
   - `balance = purchase.gross_total − sum(payments.amount)` where `purchase_id` matches
   - Status (Paid / Partial / Pending) is derived from that

2. **No duplicate price history.**
   - Price history *is* the `purchase_lines` table with its associated purchase date
   - Join back to `purchases` to see supplier, date, invoice context
   - One source of truth, never drifts

3. **Raw data preserved forever.**
   - `description_raw` stays on every line
   - If a match is later corrected, you can see what the document originally said
   - Enables re-mapping without data loss

4. **Supplier and material records are above the project.**
   - Same supplier used in multiple projects points to one record
   - Same material bought from different suppliers over time is one canonical item
   - This is what makes "why is sand more expensive this time?" a trustworthy question

---

## Data Migration Strategy (Glenferrie)

**No loss, no big-bang risk:**

1. Every existing expense row becomes a `purchase` with exactly one `purchase_line`.
2. A one-off matching pass populates `suppliers` and `items` from existing `trade` and `description` values.
3. A backwards-compatible `expenses_view` keeps existing screens working during transition.
4. Once verified, retire the view and switch to the new screens.

Result: Glenferrie's price history is preserved and now queryable by supplier and material.

---

## Data Ingestion Pipeline (for new project)

### Architecture: One pipeline, three front doors

All three sources (Excel, pasted text, invoice photo) end up in the same place:

```
Excel / pasted text / invoice photo
         ↓  (extraction)
   raw rows (stored, linked to source)
         ↓  (fuzzy matching + normalisation)
   staging table with confidence scores
         ↓  (REVIEW SCREEN — human confirmation)
   committed purchases + lines
```

### Key principle: Nothing auto-saves

Imported rows sit in a review state. You accept, correct, or reject per row. This prevents silent bad data from entering the ledger.

### Matching engine (three tiers):

| Match type | Action |
|---|---|
| Exact hit in aliases | Auto-accept, silent |
| Fuzzy match ≥ threshold | Pre-fill, flag for confirmation |
| No match | Propose new supplier/item, require confirmation |

Every confirmation writes a new alias. The system learns as you go — "paint in TASK column means Emulsion Paint" is recorded once and never asked again.

### Unit handling

**Same item, same unit** → compare unit prices, show % delta ("29% higher than March")  
**Same item, different unit** → don't show %, show the units changed ("bag → tonne: check pack size")

This makes price alerts trustworthy. A noisy alert on every import gets ignored; a precise alert on 80% of purchases is useful.

### Arithmetic validation (built-in confidence check)

Invoices come with their own checksum. If line totals don't sum to subtotal, something was misread (quantity, decimal, missed line). Auto-flag for review. This catches OCR errors at the door.

---

## Implementation Roadmap

### Phase 0: Schema + Migration (Glenferrie)
- Create new tables (`suppliers`, `items`, `supplier_aliases`, `item_aliases`, `purchases`, `purchase_lines`, `payments`)
- Write one-off script: existing `expenses` → one `purchase` + one `purchase_line` each
- Seed supplier and item records from existing trade/description values
- Review and correct aliases (one evening of manual work)
- Create backwards-compatible `expenses_view` for existing screens
- **Outcome:** Glenferrie data in new shape, existing UI unbroken

### Phase 1: Supplier & Item Pages (read-only views)
- Supplier page: select "Lawson" → all purchases, all lines, qty, unit price, balance, paid date, method, running total
- Item page: select "Building Sand" → full price timeline across all suppliers and projects
- This is the core thing you asked for, and Phase 0 makes it trivial
- **Outcome:** Answer "when did I last buy sand from Lawson?" in one click

### Phase 2: Multi-line Invoice Entry (manual form)
- Pick supplier, date, invoice number
- Add N lines, each with item, qty, unit, unit price
- Duplicate and price warnings move to the line level (now you see *which material*)
- **Outcome:** Real invoices can be logged without losing structure

### Phase 3: Excel/CSV Import + Review Screen
- Build the review screen against deterministic input (spreadsheets are predictable)
- Original row left, parsed proposal right
- Accept/correct/reject per row
- Aliases learned with each correction
- **Outcome:** Old spreadsheets can be bulk-migrated without losing data

### Phase 4: Invoice Photo & PDF + Pasted Text
- Vision model extraction (Claude API with document as base64 block)
- Zod-validated JSON output
- Lands in the *same* review screen from Phase 3
- Arithmetic guard: if line nets don't sum to invoice total, force review
- **Outcome:** Invoices and receipts enter the system reliably

### Phase 5: Price Intelligence
- Cheapest supplier per item (across all projects)
- Spend trends by supplier (is Lawson getting more expensive?)
- "You're about to pay 29% more than March" warnings at point of entry
- Material price history with best/worst/current across projects
- **Outcome:** Real business intelligence, not just a ledger

**Why this order matters:**
- Excel is predictable, so Phase 3 shakes out the review UX without debugging extraction quality simultaneously
- By Phase 4 (OCR), the hard part is already working
- Phases 1 and 2 give you working supplier views and multi-line entry before ingestion even launches
- Each phase delivers value and can run independently

---

## Key Unknowns That Would Sharpen the Design

Before Phase 4 (invoice extraction), knowing these would refine the approach:

1. **Invoice source format:** Are they mostly PDFs emailed from merchants (clean, selectable text, ~99% reliable) or phone photos of paper taken on-site (creased, angled, ~85% reliable)? This affects how much review friction to design for.

2. **Sample data:** A supplier invoice (PDF or photo) and a slice of your old spreadsheet with the messy TASK/Notes columns would let us design the extraction and mapping rules against your actual data rather than assumptions.

---

## Why Route C Over Other Options

| Route | What it fixes | What it doesn't |
|---|---|---|
| **A (Patch in place)** | Supplier filter, named warnings | Text duplication, multi-line invoices, payment dates, import |
| **B (Reference layer)** | Lookup, price history, supplier pages | Multi-line invoices, payment dates, invoice upload |
| **C (Restructure core)** | Everything | (none — this is the floor) |

Route B is tempting because it's cheaper, but it leaves the invoice problem unsolved. Given you've committed to handling multi-line invoices and want to import them, you end up at C eventually — doing B first just means touching the schema twice.

---

## Next Steps (in order)

1. **Clarify invoice format:** Digital PDFs or phone photos?
2. **Share sample data:** One real invoice + a slice of the old spreadsheet.
3. **Confirm the unit question:** Does "Building Sand, 25kg bag" ever get bought in different pack sizes from the same supplier? (affects whether unit normalization is necessary).
4. **Plan the Glenferrie migration:** Decide whether to migrate during Phase 0 or after Phase 1 is working (migrating first is cleaner, but if the new UI isn't ready, you'll be without views for a while).
5. **Begin Phase 0:** Schema creation and migration script.

---

## Summary Table

| Aspect | Current | Proposed |
|---|---|---|
| **Supplier records** | Text field, no grouping | Proper entity with aliases |
| **Material records** | Text field, no canonical identity | Proper entity with unit + pack size |
| **Invoice structure** | One row per item | One purchase header + N lines |
| **Payment detail** | Amount only | Amount, date, method per payment |
| **Balance** | Stored number (drifts) | Calculated (always correct) |
| **Data entry** | Manual typing only | Manual + Excel + text + invoice OCR |
| **Price history** | Unreliable (text matching) | Trustworthy (canonical items, units tracked) |
| **Supplier view** | "What did Lawson do?" → unstructured | Click supplier → all purchases, all lines, balances, dates |
| **Material view** | "When did I last buy sand?" → unreliable | Click item → timeline across all suppliers and projects |
| **Glenferrie data** | Locked in spreadsheet shape | Migrated, queryable, reusable |

---

## Confidence Level

This approach is proven architecture for multi-project asset/cost tracking. The specific shapes (suppliers above projects, canonical items with aliases, purchase headers + lines, calculated balance) are standard in accounting and inventory systems precisely because they solve the problems you've described.

The main execution risk is the ingestion pipeline — getting the review UX right so that correcting one invoice doesn't feel like data entry hell. That's why it's built in phases: the matching engine is solved before the extraction engine, and both are tested against deterministic input before OCR arrives.

**Ready to move to Phase 0 whenever you are.**
