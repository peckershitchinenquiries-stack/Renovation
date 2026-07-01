import { requireUser, json, error } from "@/lib/api";
import { validateExpense, hasErrors } from "@/lib/validation";
import { computeEntries } from "@/lib/calculations";
import { buildExpensePayload } from "@/lib/expense";
import type { ExpenseEntry } from "@/types";

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

  const { data, error: dbError } = await query;
  if (dbError) return error(dbError.message, 500);
  // Attach computed cost fields (total_incl_vat is never stored).
  return json(computeEntries((data ?? []) as ExpenseEntry[]));
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
