import { requireUser, json, error } from "@/lib/api";
import { validateExpense, hasErrors } from "@/lib/validation";
import { computeEntries } from "@/lib/calculations";
import { buildExpensePayload } from "@/lib/expense";
import { computePurchases, purchasesToSyntheticEntries } from "@/lib/purchases";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExpenseEntry,
  ExpenseEntryComputed,
  Payment,
  Purchase,
} from "@/types";

/**
 * Every row the Expenses tab shows: hand-entered expense_entries AND the
 * invoices filed against this project, the latter as synthetic entries.
 *
 * The merge has to happen here as well as in getProjectBundle, because this is
 * what the tab refetches after a change. When it returned expense_entries
 * alone, marking an invoice paid emptied the list — the invoice rows simply
 * were not in the reply, and with the spreadsheet import gone there was nothing
 * else left to show.
 */
async function loadInvoiceEntries(
  supabase: SupabaseClient,
  projectId: string
): Promise<ExpenseEntryComputed[]> {
  // Cancelled invoices are included: the list shows them so they can be
  // un-cancelled, and every total computed from these rows excludes them by
  // status anyway.
  const { data: rawPurchases } = await supabase
    .from("purchases")
    .select("*")
    .eq("project_id", projectId);
  const purchases = (rawPurchases ?? []) as Purchase[];
  if (purchases.length === 0) return [];

  const ids = purchases.map((p) => p.id);
  const supplierIds = [
    ...new Set(purchases.map((p) => p.supplier_id).filter((v): v is string => Boolean(v))),
  ];

  const [{ data: rawPayments }, { data: suppliers }] = await Promise.all([
    supabase.from("payments").select("*").in("purchase_id", ids),
    supplierIds.length > 0
      ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [] }),
  ]);

  return purchasesToSyntheticEntries(
    computePurchases(purchases, (rawPayments ?? []) as Payment[]),
    new Map(
      ((suppliers ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name])
    )
  );
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(req.url);
  let query = auth.supabase
    .from("expense_entries")
    .select("*")
    .eq("project_id", params.id);

  const week = searchParams.get("week");
  const weekFrom = searchParams.get("week_from");
  const weekTo = searchParams.get("week_to");
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const trade = searchParams.get("trade");
  const payment_method = searchParams.get("payment_method");

  if (week) query = query.eq("week_number", Number(week));
  if (weekFrom) query = query.gte("week_number", Number(weekFrom));
  if (weekTo) query = query.lte("week_number", Number(weekTo));
  if (category) query = query.eq("category", category);
  if (status) query = query.eq("status", status);
  if (trade) query = query.eq("trade", trade);
  if (payment_method) query = query.eq("payment_method", payment_method);

  query = query
    .order("week_number", { ascending: true })
    .order("created_at", { ascending: true });

  const [{ data, error: dbError }, invoiceEntries] = await Promise.all([
    query,
    loadInvoiceEntries(auth.supabase, params.id),
  ]);
  if (dbError) return error(dbError.message, 500);

  // The same filters, applied to the invoice rows in memory. They cannot go
  // into the SQL above because they describe expense_entries columns, and an
  // invoice's equivalents live on `purchases` under different names.
  const filteredInvoices = invoiceEntries.filter((e) => {
    if (week && e.week_number !== Number(week)) return false;
    if (weekFrom && e.week_number < Number(weekFrom)) return false;
    if (weekTo && e.week_number > Number(weekTo)) return false;
    if (category && e.category !== category) return false;
    if (status && e.status !== status) return false;
    if (trade && e.trade !== trade) return false;
    // payment_method is not recorded on a purchase header — it belongs to each
    // payment. Filtering on it therefore excludes every invoice rather than
    // silently pretending they all match.
    if (payment_method) return false;
    return true;
  });

  // Attach computed cost fields (total_incl_vat is never stored).
  return json([
    ...computeEntries((data ?? []) as ExpenseEntry[]),
    ...filteredInvoices,
  ]);
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const errors = validateExpense(body);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  // Ensure the project belongs to the user (RLS also enforces this).
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  const insert = {
    ...buildExpensePayload(body),
    project_id: params.id,
    user_id: auth.user.id,
  };

  const { data, error: dbError } = await auth.supabase
    .from("expense_entries")
    .insert(insert)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  return json(data, 201);
}
