# Claude Code prompts — invoice ingestion (Route C, Phases 0–5)

Ready-to-paste prompts derived from `invoice-ingestion-prompt.md`. Run each in a
**separate Claude Code session**, in order. Do not start the next session until
the previous one's build passes and (where relevant) its migration has actually
been run in the Supabase SQL editor.

## Where the work already stands (2026-08-17)

Phases 1–3 of the source plan were **already built** in an earlier session, but
never committed and never logged in `updates.md`:

- `supabase/migrations/0010_invoice_upload.sql` — written, **not yet run**.
- `lib/invoice/schema.ts`, `prompt.ts`, `extract.ts`, `normalise.ts`,
  `reconcile.ts`, `resolve.ts` — written.
- `types/index.ts` — already carries `InvoiceUpload`, `InvoiceUploadStatus`,
  `ExtractionMethod`.

Missing entirely: **the API routes (Phase 4) and the whole UI (Phase 5)**.

So Session 1 below is an audit-and-log session, not a build session. Sessions
2–5 build what is left.

## Repo facts every prompt assumes

- Migrations are pasted into the Supabase SQL editor by hand, in filename order.
- No query filters by `user_id`; RLS does it. Policy pattern is a single
  `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`.
- Route Handlers use `requireUser()` / `json()` / `error()` from `lib/api.ts`.
- Client Components mutate via `apiFetch` from `lib/fetcher.ts`.
- The manual multi-line invoice form is `components/forms/PurchaseForm.tsx` —
  that is the form the review screen must reuse, **not** `ExpenseForm.tsx`
  (which is the older single-row diary form).
- Writes go through `createPurchase` in `lib/purchaseWrite.ts`.
- `npm run build` is the only full typecheck. There is no test suite.
- Every change needs an `updates.md` entry. See CLAUDE.md.

---

## Session 1 — Audit and log Phases 1–3, then run migration 0010

```
Read CLAUDE.md, then about.md in full, then the last three entries of updates.md.
Then read invoice-ingestion-prompt.md in the repo root — that is the spec this
work is being built against.

CONTEXT
An earlier session built Phases 1-3 of that spec but never committed the work and
never logged it. Nothing has been verified. Migration 0010_invoice_upload.sql has
NOT been run in the Supabase SQL editor yet. Your job this session is to audit
what exists, fix only what is actually wrong, and write it up — not to build
Phases 4 or 5.

AUDIT (output first, no edits until you have reported)

1. Read supabase/migrations/0010_invoice_upload.sql end to end. Check it against
   the Phase 1 section of invoice-ingestion-prompt.md and report, item by item,
   what is present and what is missing:
     - invoice_uploads with every listed column and the status enum
     - supplier_aliases and item/material aliases (note: 0008 may already have
       created supplier_aliases and item_aliases — say which, and whether 0010
       duplicates or extends them)
     - private storage bucket + RLS on storage.objects
     - pg_trgm + GIN trigram indexes on the normalised name columns
     - unique constraint on (supplier_id, invoice_no) on purchases
     - suppliers.created_from_upload_id and suppliers.is_unverified
     - partial unique index on normalised VAT number
     - merge_suppliers(source_id, target_id) RPC, transactional
     - RLS policies on all new tables matching the repo's existing pattern
2. Confirm 0010 is safe to run against the live database as it stands:
     - is every statement guarded / re-runnable?
     - does it depend on anything 0008 or 0009 did not create?
     - the unique constraint on (supplier_id, invoice_no) is the risky one.
       Write me a read-only SELECT I can run FIRST to find existing violations,
       and make the migration fail loudly rather than delete rows if any exist.
3. Read lib/invoice/schema.ts, prompt.ts, extract.ts, normalise.ts, reconcile.ts
   and resolve.ts. Check each against Phases 2 and 3 of the spec. Report
   specifically:
     - is every schema field nullable-not-optional?
     - does extract.ts genuinely branch text-layer vs vision, and is the
       text-layer detection conservative?
     - is ANTHROPIC_API_KEY read server-side only, with no client import path?
     - are reconciliation results warnings, never hard failures?
     - does resolve.ts follow the strict priority order VAT -> alias -> trigram,
       and does the VAT guard override the band to exact before offering a draft?
     - does resolve.ts write anything? It must not — it returns a draft only.
4. Run `npm run build` and report the result.
5. List every conflict between the existing code and the spec, and every place
   the existing code disagrees with about.md.

THEN
Fix only what the audit shows is actually broken or missing. Do not refactor
anything that works. Do not start Phase 4 or 5.

FINISH
- Write ONE updates.md entry covering all of it, in the house style: what was
  built, where it came from, files read, files changed, that migration 0010 was
  written and NOT yet run, and what I have to do by hand.
- Update about.md if the audit changed anything it documents.
- Tell me, as a numbered checklist, exactly what to paste into the Supabase SQL
  editor and in what order, including the violation-check SELECT first.
- Commit with a clear message. Do not commit the .xlsx files.
```

**After this session:** run the violation check, then run `0010` in the Supabase
SQL editor. Confirm `invoice_uploads`, `match_suppliers`, `match_items`,
`merge_suppliers` and the private `invoices` bucket all exist before Session 2.

---

## Session 2 — Phase 4: API routes

```
Read CLAUDE.md, then about.md §§3-5, then the last two entries of updates.md, then
invoice-ingestion-prompt.md (Phase 4 and Constraints). Migration 0010 has now been
run — verify that by reading it, and assume its tables, RPCs and the private
`invoices` storage bucket exist.

GOAL
Three Route Handlers so a file can go from the browser into invoice_uploads,
through the extractor, and out into purchases. No UI this session.

READ FIRST (match these conventions, do not invent new ones)
- lib/api.ts — requireUser / json / error, and the "response" in auth guard.
- app/api/projects/[id]/purchases/route.ts — the closest existing write route.
- app/api/expenses/[eid]/receipt/route.ts — existing storage handling. NOTE: it
  POSTs the file through the route. Do NOT copy that pattern here; see below.
- lib/purchaseWrite.ts — createPurchase, resolveSupplierId, resolveItemIds.
- lib/invoice/extract.ts and resolve.ts — already written; call them, don't
  rewrite them.
- types/index.ts — InvoiceUpload, InvoiceUploadStatus, ExtractionMethod exist.

BUILD

1. POST /api/invoices/upload-url
   Body: project_id, filename, mime_type, file_size.
   - Validate mime against image/jpeg, image/png, image/webp, application/pdf.
   - Cap size at 20MB. Reject with 415 / 413 like the receipt route does.
   - Confirm the project belongs to the user (RLS-backed read -> 404 if not).
   - Storage path MUST begin `${user.id}/` — the 0010 storage policies key off
     storage.foldername(name)[1] = auth.uid()::text. Getting this wrong makes
     every upload 403 with no useful message.
   - Insert the invoice_uploads row with status 'pending'.
   - Return a Supabase signed UPLOAD url plus the new row id.
   The file itself never passes through this route. Vercel caps serverless
   request bodies at 4.5MB and a phone photo is bigger than that — the browser
   uploads straight to storage with the signed url. This is a deliberate
   departure from the receipt route; say so in a comment.

2. POST /api/invoices/[id]/extract
   - export const maxDuration = 60
   - Load the upload row, verify ownership, set status 'processing'.
   - Download the file from storage server-side, call extractInvoice from
     lib/invoice/extract.ts, Zod-parse, run reconcile, then resolveSupplier and
     resolveItems.
   - Write extraction_raw as the model returned it, unmodified. Write
     extraction_method and the terminal status.
   - Wrap the whole body in try/catch that ALWAYS lands on a terminal status.
     A row must never be left stuck in 'processing'. A Zod failure sets 'failed'
     with the error text stored, and the row stays retryable — calling this route
     again on a 'failed' row must work.
   - Return the extraction, the reconciliation warnings, and the supplier/item
     resolutions to the caller.

3. POST /api/invoices/[id]/commit
   - Takes the reviewed and possibly edited payload, shaped as PurchaseInput.
   - Go through createPurchase in lib/purchaseWrite.ts so header + lines are
     written the same way the manual form writes them. Do not write a second
     insert path.
   - Always write an alias: existing supplier chosen -> insert the RAW invoice
     string into supplier_aliases; new-supplier draft accepted -> insert the
     supplier with is_unverified true and created_from_upload_id set, and its
     raw invoice string as its first alias, in the same transaction. If the user
     edited the supplier name, the alias is still the invoice's raw string.
   - Set status 'committed' and link invoice_id / purchase id.

ALSO
- A GET route or a lib helper returning a signed READ url for the stored file,
  so the review screen can display the original. Server-side only.

CONSTRAINTS
- TypeScript strict, no `any`.
- ANTHROPIC_API_KEY server-side only. Nothing in lib/invoice may become
  reachable from a Client Component.
- Verify auth AND ownership on every route.
- Don't add dependencies. Don't refactor unrelated code.

FINISH
- `npm run build` must pass.
- Add the updates.md entry (routes added, files read, files changed, no
  migration this session).
- Commit as one clear "Phase 4" commit.
```

---

## Session 3 — Phase 5a: entry point + upload view

```
Read CLAUDE.md, then about.md, then the last two entries of updates.md, then
invoice-ingestion-prompt.md (Phase 5, first two bullets). Phase 4's routes exist
— read them before you start.

GOAL
Get a file from the user's phone into storage and through extraction, with honest
status the whole way. The review screen is the NEXT session — this one ends at
"extraction finished, here is where we'd hand off".

READ FIRST
- components/forms/PurchaseForm.tsx and components/forms/AddExpensePanel.tsx —
  the existing add-a-purchase path and its layout conventions.
- app/(app)/projects/[id]/purchases/new/page.tsx
- lib/fetcher.ts (apiFetch), components/ui/Toast.tsx, States.tsx, Drawer.tsx —
  use these, don't roll your own spinner or toast.
- lib/supabase/client.ts — the browser client, for the Realtime subscription.

BUILD

1. Entry point. Wherever "Add" currently leads straight to the purchase form,
   put two clear choices in front of it: "Upload invoice" and "Enter manually".
   Manual entry must reach exactly the screen it reaches today, unchanged.

2. Upload view (Client Component).
   - Drag-and-drop plus a file picker. On mobile that means the camera too.
   - Client-side type and size validation mirroring the server's, so the
     obvious rejections happen before the round trip.
   - Flow per file: POST /api/invoices/upload-url -> PUT the file straight to
     the signed url -> POST /api/invoices/[id]/extract. Show real upload
     progress; a 12MB photo on a phone connection is not instant.
   - Support queuing several files. Each one gets its own row and its own
     status; one failure must not take the others down.
   - Processing state driven by a Supabase Realtime subscription on the
     invoice_uploads row, with a polling fallback if the subscription doesn't
     connect. Never leave the user watching a spinner with no terminal state.
   - 'failed' rows show the stored error plus "Retry" and "Enter manually
     instead". Retry re-POSTs the extract route on the same row.
   - 'extracted' rows link through to the review route (which does not exist
     yet — stub the route with a placeholder page this session and say so).

CONSTRAINTS
- No new state management library. Local state and the existing patterns only.
- No API keys or service-role client anywhere in a Client Component.
- Match the existing Tailwind conventions and the mobile-first layout already in
  the repo — read a neighbouring screen before styling anything.
- TypeScript strict, no `any`.

FINISH
- `npm run build` must pass.
- Confirm to me in the summary that a >4.5MB file never passes through a Next.js
  route handler in this flow.
- updates.md entry. Commit as "Phase 5a".
```

---

## Session 4 — Phase 5b: the review screen

```
Read CLAUDE.md, then about.md §§4-8 (especially §4.6 on aliases), then the last
two entries of updates.md, then invoice-ingestion-prompt.md (Phase 5 "Review
screen" and the whole Acceptance criteria list). Phases 4 and 5a exist — read
them first.

GOAL
The screen where a human accepts or corrects the extraction, then saves. This is
the hard one; the whole feature is judged here.

THE ONE RULE THAT MATTERS
There must be exactly ONE purchase form in this codebase when you are done.
The review screen reuses components/forms/PurchaseForm.tsx, prefilled from the
extraction. Do not build a second form. If PurchaseForm needs new props to accept
prefilled values, warnings and a supplier resolution, add them — additively, so
the manual path behaves exactly as it does today.

BUILD

1. Layout: the original invoice (signed read url from Phase 4) shown alongside
   the prefilled form. Every field editable.

2. Reconciliation warnings appear inline on the specific field that failed —
   line total on that line, subtotal under the subtotal. Not a banner at the top.
   They never block the save. PurchaseForm already does per-line warnings via
   PriceMoveBadge; follow that pattern.

3. Supplier field branches on the confidence band that lib/invoice/resolve.ts
   returns (read it — the bands are certain / likely / possible / none):
   - certain: preselected, shown as confirmed, with a visible "change".
   - likely / possible: candidate list with match scores, plus an explicit
     "none of these — add new supplier".
   - none: the new-supplier form is shown ALREADY EXPANDED AND PREFILLED from
     newSupplierDraft, with a collapsed "search existing suppliers instead" link
     above it. An unrecognised supplier is one click to accept, never a detour,
     and never a blocker on the save.
   The inline new-supplier form must be the same component as the standalone
   supplier-creation form. Extract that component if it isn't already one.

4. Same pattern for items on each line description.

5. Duplicate check on (supplier, invoice_no) runs BEFORE the review screen
   renders. On a hit: "You already logged this invoice on <date>", with a link.
   The user must never hit a database constraint error at save time.
   types/index.ts already has an InvoiceRef type for this — check whether the
   existing purchase form's duplicate warning can be reused.

6. Save posts to /api/invoices/[id]/commit and lands the user on the created
   purchase.

CONSTRAINTS
- TypeScript strict, no `any`. No new dependencies. No state library.
- Do not change what the manual entry path does. If you touch PurchaseForm,
  every existing prop and behaviour must still work identically.
- Don't refactor unrelated code. If you find something broken, report it.

FINISH
- `npm run build` must pass.
- In your summary, state plainly how many purchase form components exist in the
  codebase and where.
- updates.md entry. Commit as "Phase 5b".
```

---

## Session 5 — Acceptance pass

```
Read CLAUDE.md, about.md, and the updates.md entries for Phases 1-5. Then read
the "Acceptance criteria" list at the end of invoice-ingestion-prompt.md.

GOAL
Verify the feature against every acceptance criterion. This is an audit session:
report first, and only fix what is genuinely broken.

For EACH criterion, tell me one of: verified in code (cite file:line), needs a
manual test by me (give me the exact steps), or FAILS (explain, then fix).

Pay particular attention to:
- Exactly one purchase form component in the codebase.
- No API key, and no service-role Supabase client, reachable from the client
  bundle. Grep for ANTHROPIC_API_KEY and SERVICE_ROLE and trace every import
  chain from a "use client" file. Prove it, don't assert it.
- A malformed model response leaves a retryable 'failed' row, not a crash.
- No path leaves a row stuck in 'processing'.
- Confirming a supplier match ALWAYS writes an alias — trace both branches.
- A second invoice from the same supplier under a different spelling but the
  same VAT number resolves to the existing record.
- merge_suppliers repoints purchases and aliases and leaves no orphans.
- Existing manual entry behaviour is byte-for-byte unchanged in effect —
  diff PurchaseForm against its pre-Phase-5b state and account for every change.

THEN
- Run `npm run build`.
- Give me a numbered manual test script for the things that can only be checked
  against the live app: a 12MB phone photo, a digital PDF (confirm the text path
  was taken and no image tokens were sent — check the logged
  extraction_method), a duplicate re-upload, and a brand-new supplier.
- Update about.md so §13 and the schema sections describe the feature as built.
- Final updates.md entry. Commit.
```
