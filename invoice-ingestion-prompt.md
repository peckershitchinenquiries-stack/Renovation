# Implementation prompt — invoice ingestion for RenovaTrack

> Paste this into Claude Code (or your agent of choice) from the repo root.
> Fill in the `<<< >>>` placeholders before running — they're things only you know.

---

## Context

RenovaTrack is a renovation cost tracking app. Stack: Next.js (App Router) + TypeScript + Supabase (Postgres, Auth, Storage), deployed on Vercel.

The purchases model is already split into **invoice headers** and **line items**, with **canonical supplier** and **canonical material** records. Expenses are currently added through a single manual entry form.

Relevant existing tables (confirm these names in Phase 0, don't assume):
- `<<< invoices / purchases table name >>>` — invoice headers
- `<<< line items table name >>>`
- `<<< suppliers table name >>>` — canonical suppliers
- `<<< materials table name >>>` — canonical materials

The manual entry form currently lives at `<<< path, e.g. app/expenses/new/page.tsx >>>`.

## Goal

Add a second way to create an expense: upload an invoice (image or PDF), extract it automatically, and let the user confirm before it's saved. Clicking "Add expense" should present two choices — **Upload invoice** and **Manual entry** — that converge on the same review-and-save form.

## Key design decisions (already made — implement these, don't re-litigate)

1. **No Tesseract / no OCR library.** Send the file to a vision-capable LLM directly. OCR flattens the invoice table and destroys line-item column alignment, which is the exact thing we need.
2. **Detect a PDF text layer first.** If the PDF has real embedded text (extract with `unpdf`), send *text* to the model instead of an image — cheaper, faster, more accurate. Only use the vision path for scans and phone photos.
3. **Direct browser-to-storage upload** via a Supabase signed upload URL. Never POST the file through an API route — Vercel caps serverless request bodies at 4.5MB and phone photos exceed that. The API route receives only the storage path.
4. **Async with status polling.** Create an upload row with `status: 'pending'`, process it, update the status. Subscribe via Supabase Realtime. A timeout must leave a retryable row, never a lost upload.
5. **One review form, two ways to populate it.** The review screen must reuse the existing manual entry component, prefilled. Do not build a parallel form — that causes validation drift.
6. **Unknown suppliers must be creatable inline.** Invoices will regularly arrive from suppliers not yet in the canonical list — this is expected, not an error state. Create them from the extracted data, but always through an explicit one-click confirmation, never silently. Silent creation produces duplicate records for the same supplier under different spellings, which splits spend reporting. Same policy for materials.

## Model / provider

Use `<<< provider + model, e.g. Gemini 3.1 Flash-Lite via @google/genai >>>`.
API key in `<<< env var name >>>`. Server-side only — never expose it to the client.

---

## Phase 0 — Recon (do this first, output only, no code)

Before writing anything:

1. Read the existing schema for the four tables above. Report the actual column names, types, and foreign key relationships.
2. Read the manual entry form. Report its component structure, its validation schema (Zod?), and its submit handler — specifically how it writes headers vs line items and whether it's wrapped in a transaction or RPC.
3. Report how Supabase clients are instantiated in this repo (server client, browser client, service-role client) and how auth/RLS is currently handled on writes.
4. Check whether Supabase Storage is already in use and whether any bucket exists.
5. List anything in the above that conflicts with the design decisions, and flag it.

Then propose a file-by-file implementation plan and **stop for my approval.** Do not begin Phase 1 until I approve.

---

## Phase 1 — Schema

Write a migration adding:

- **`invoice_uploads`** — `id`, `user_id`, `project_id`, `storage_path`, `original_filename`, `mime_type`, `file_size`, `status` (enum: `pending | processing | extracted | failed | committed`), `extraction_raw` (jsonb — the model's unmodified output), `extraction_error` (text), `invoice_id` (nullable FK, set on commit), timestamps.
- **`supplier_aliases`** — `id`, `supplier_id` FK, `alias_raw` (the exact string as it appeared on an invoice), `alias_normalised`, `created_at`. Unique on `alias_normalised`.
- **`material_aliases`** — same shape, FK to materials.
- A private Storage bucket for invoice files, with RLS restricting reads to the owning user.
- `CREATE EXTENSION IF NOT EXISTS pg_trgm;` plus GIN trigram indexes on the normalised supplier and material name columns.
- A unique constraint on `(supplier_id, invoice_number)` on the invoice headers table — **check for existing violations before adding it** and report them to me rather than silently dropping rows.
- On the suppliers table: `created_from_upload_id` (nullable FK to `invoice_uploads`) and `is_unverified` (boolean, default false). Suppliers created during invoice review get both set, so I can review auto-created records later and spot near-duplicates.
- A partial unique index on the suppliers table's normalised VAT number where it is not null. VAT number is the only genuinely reliable supplier identity on a UK invoice — enforce it.
- A `merge_suppliers(source_id, target_id)` RPC: repoints all invoice headers and aliases from source to target, moves the source's name into `supplier_aliases` for the target, then deletes the source. Transactional.
- RLS policies on all new tables matching the existing pattern in this repo.

Storing `extraction_raw` is deliberate: it lets us re-run extraction against better models later and gives an audit trail. Don't skip it.

---

## Phase 2 — Extraction

**Zod schema** (`lib/invoice/schema.ts`): every field nullable except `line_items` (which may be an empty array). Nullable is not optional — the model must explicitly return `null`. Fields: supplier `{ name, vat_number, address }`, `invoice_number`, `invoice_date` (ISO `YYYY-MM-DD`), `currency` (default `GBP`), `subtotal`, `vat_amount`, `total`, and `line_items[]` of `{ description, quantity, unit, unit_price, line_total, vat_rate }`.

**Prompt for the model:**
- Return JSON only — no prose, no markdown fences.
- Return `null` for any field not present on the invoice. Never infer, never guess a plausible value.
- Transcribe line items exactly as printed, one object per row.
- Dates as `YYYY-MM-DD`. Amounts as numbers, no currency symbols or thousands separators.

**Reconciliation checks** — run these and attach the results as *warnings*, never as hard validation failures:
- `sum(line_total)` vs `subtotal` (tolerance: 2p)
- `subtotal + vat_amount` vs `total`
- `quantity × unit_price` vs `line_total` per row

A failed Zod parse sets `status: 'failed'` with the error stored. It must be retryable from the UI. Never discard the upload.

---

## Phase 3 — Resolution

`lib/invoice/resolve.ts`, resolving in strict priority order:

1. **Exact match on normalised VAT number** against existing suppliers. Highest confidence.
2. **Exact match on `supplier_aliases.alias_normalised`.**
3. **Trigram similarity** on the normalised name, threshold `0.35`, return top 5 ordered by score descending.

Normalisation: lowercase, strip `ltd`/`limited`/`plc`/`llp`/`& co`/`t/a`, strip punctuation and collapse whitespace.

Return candidates with a confidence band (`exact` / `likely` / `uncertain` / `none`) — the UI branches on this. Apply the identical pattern to materials for line item descriptions.

**When nothing matches (`none`)**, this is a normal outcome, not a failure. Return a `newSupplierDraft` built from the extraction — name, VAT number, address — cleaned and title-cased, ready for the user to accept. The resolver's job is to hand the UI a draft, not to write anything.

**Before offering the draft**, run one last guard: if the extracted VAT number matches an existing supplier's, override the band to `exact` and return that supplier regardless of how different the names look. Trading names change; VAT numbers don't.

**On commit:**
- If an existing supplier was chosen, insert the raw invoice string into `supplier_aliases`.
- If the new-supplier draft was accepted, insert the supplier with `is_unverified: true` and `created_from_upload_id` set, **and** insert the raw invoice string as its first alias in the same transaction.

Either way an alias is always written. This is the mechanism that makes the feature get quieter over time — do not skip it.

---

## Phase 4 — API routes

- `POST /api/invoices/upload-url` — validate mime type (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`) and size (cap 20MB), return a signed upload URL plus the created `invoice_uploads` row id.
- `POST /api/invoices/[id]/extract` — set `processing`, fetch from storage, branch text-layer vs vision, call the model, Zod-parse, resolve suppliers/materials, write `extraction_raw` and status. Wrap in try/catch that always leaves a terminal status — never leave a row stuck in `processing`.
- `POST /api/invoices/[id]/commit` — insert header + line items in a single transaction (use an RPC if the existing code does), write aliases, set `status: 'committed'` and link `invoice_id`.

Add `export const maxDuration = 60` to the extract route. Verify auth and ownership on every route.

---

## Phase 5 — UI

- **Add expense entry point** — two clear options, Upload invoice and Manual entry.
- **Upload view** — drag-and-drop plus file picker, client-side type/size validation, upload progress, then a processing state driven by a Supabase Realtime subscription on the upload row. Support queuing multiple files.
- **Review screen** — the original invoice rendered alongside the prefilled form. Every field editable. Reconciliation warnings shown inline on the specific field that failed, not as a banner.
  - Supplier field, branching on confidence band:
    - `exact` — preselected, shown as confirmed, with a "change" affordance.
    - `likely` / `uncertain` — candidate list with match scores, plus a "none of these — add new supplier" option.
    - `none` — the new-supplier form is shown **already expanded and prefilled** from `newSupplierDraft`, with a collapsed "search existing suppliers instead" link above it. An unrecognised supplier should be one click to accept, not a detour. Never block the save on it.
  - The inline new-supplier form must be the same component as the standalone supplier-creation form, so validation stays in one place.
  - If a supplier is created and the user then edits the name before saving, store the *invoice's* raw string as the alias, not the edited name — the alias exists to match future invoices, which will carry the raw string.
  - Duplicate check on `(supplier, invoice_number)` runs *before* the review screen renders. On a hit, show "You already logged this invoice on <date>" with a link to it — do not let the user hit a database constraint error at save time.
  - Failed extractions offer "Retry" and "Enter manually instead" (falling through to the blank manual form with the uploaded file still attached).

---

## Acceptance criteria

- [ ] Both entry paths reach the same review component; there is exactly one expense form in the codebase.
- [ ] A 12MB phone photo uploads successfully (proves the signed-URL path works).
- [ ] A digital PDF invoice takes the text path — verify no image tokens are sent.
- [ ] A malformed model response leaves a `failed` row that can be retried, not a crash.
- [ ] Re-uploading the same invoice is caught and surfaced before save.
- [ ] Confirming a supplier match writes an alias; re-uploading a second invoice from that supplier resolves at confidence `exact` without asking.
- [ ] An invoice from a supplier not in the list is saveable without leaving the review screen, in one click from the prefilled draft.
- [ ] That newly created supplier is flagged `is_unverified` and gets an alias row.
- [ ] A second invoice from that same new supplier, with the name spelled differently but the same VAT number, resolves to the existing record rather than creating a second one.
- [ ] `merge_suppliers` repoints invoices and aliases and leaves no orphans.
- [ ] No API keys reachable from the client bundle.
- [ ] Existing manual entry behaviour is unchanged.

## Constraints

- TypeScript strict — no `any` in new code.
- Match existing conventions in this repo for file layout, naming, error handling and data fetching. Read neighbouring files before writing new ones.
- Don't add a state management library. Don't add an ORM.
- Don't refactor unrelated code. If you find something broken, report it — don't fix it in this PR.
- Commit in phases with clear messages, not one large commit.
