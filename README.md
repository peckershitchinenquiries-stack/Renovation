# RenovaTrack

Renovation Project Cost Tracker — Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase.

Built to the WebCross RenovaTrack v1.0 requirements: multi-project renovation
cost tracking with auto-calculated labour/materials/VAT, per-trade & per-supplier
payment tracking, a budget-vs-forecast dashboard, receipt uploads, and PDF/Excel export.

## Tech stack

| Layer        | Technology                        |
| ------------ | --------------------------------- |
| Framework    | Next.js 14 (App Router)           |
| Language     | TypeScript                        |
| Styling      | Tailwind CSS                      |
| Database     | Supabase (PostgreSQL)             |
| Auth         | Supabase Auth (email/password)    |
| File storage | Supabase Storage (`receipts`)     |
| Charts       | Recharts                          |
| PDF export   | @react-pdf/renderer               |
| Excel export | xlsx (SheetJS)                    |
| Deployment   | Vercel                            |

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at https://supabase.com.

3. **Run the schema.** In the Supabase SQL editor, paste and run
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   This creates all tables, RLS policies, indexes, the `receipts` storage bucket,
   and a trigger that seeds the default trade lookups for every new user.

4. **Configure environment.** Copy `.env.local.example` to `.env.local` and fill in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

5. **Create a user.** Public sign-up is disabled in v1 — add a user in the
   Supabase dashboard (Authentication → Users) or enable email confirmations.
   The seed trigger fills in default trades on first insert.

6. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 and sign in.

## Project structure

```
app/
  page.tsx                     Login (+ forgot password)
  reset-password/              Password reset
  (app)/                       Authenticated shell (top nav + mobile bottom nav)
    dashboard/                 Project cards with budget-used %
    projects/                  Project list, create, edit
    projects/[id]/             Tabbed detail: Overview | Expenses | Trades | Materials
    projects/[id]/expenses/new Full-screen add-expense (mobile)
    settings/                  Trade rate lookups
  api/                         Route handlers (see requirements §7)
components/
  ui/ forms/ charts/ project/ settings/
lib/
  supabase/  client/server/middleware Supabase clients
  calculations.ts            Cost helpers (labour, materials, VAT, totals)
  summary.ts                 Dashboard / trades / materials aggregations
  validation.ts              Shared client + server validation
  export.ts  pdf.tsx         Excel + PDF generation
types/index.ts               Shared types
```

## Business rules

`total_incl_vat` is never stored — it is computed on every read in
`lib/calculations.ts` (`computeEntry`). Forecast Total sums non-Cancelled
entries; Paid to Date sums `Paid` entries; Variance = Forecast − Target Budget
(red when over, green when under). VAT is 0% or 20% only.

## Notes

- All API routes require a valid Supabase session and rely on Row-Level
  Security so users only ever see their own data.
- Receipts are validated for MIME type and size (≤10MB) **server-side** before
  the storage path is saved; the bucket is private and served via short-lived
  signed URLs.
- Forms are usable at a 375px viewport with 44px touch targets and a mobile
  bottom nav, per the on-site mobile requirement.
