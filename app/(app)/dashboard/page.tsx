import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeEntries, formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import type { Project, ExpenseEntry } from "@/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const [{ data: projects }, { data: rawEntries }] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("expense_entries").select("*"),
  ]);

  // Spend must come from the week-by-week diary only. 'ledger' rows are the
  // imported Trades / Materials reference set — summing both double-counts the
  // same spend (and the target budget is itself derived from the ledger).
  // Mirrors the filter in ProjectDetail.tsx so card and Overview agree.
  const entries = computeEntries((rawEntries ?? []) as ExpenseEntry[]).filter(
    (e) => e.source !== "ledger"
  );
  const spentByProject = new Map<string, number>();
  for (const e of entries) {
    if (e.status === "Cancelled") continue;
    spentByProject.set(
      e.project_id,
      (spentByProject.get(e.project_id) ?? 0) + e.total_incl_vat
    );
  }

  const list = (projects ?? []) as Project[];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Link href="/projects/new" className="btn-primary">
          + Create project
        </Link>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first renovation project to start tracking costs."
          action={
            <Link href="/projects/new" className="btn-primary">
              Create project
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => {
            const spent = spentByProject.get(p.id) ?? 0;
            const budget = Number(p.target_budget);
            const usedPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
            const over = budget > 0 && spent > budget;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="card transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-gray-900">{p.name}</h2>
                  <Badge label={p.status} />
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Spent</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(spent)}
                    </span>
                  </div>
                  {budget > 0 && (
                    <div className="flex justify-between">
                      <span>Budget</span>
                      <span>{formatCurrency(budget)}</span>
                    </div>
                  )}
                </div>
                {budget > 0 && (
                  <div className="mt-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full ${over ? "bg-red-500" : "bg-brand"}`}
                        style={{ width: `${Math.min(usedPct, 100)}%` }}
                      />
                    </div>
                    <p
                      className={`mt-1 text-xs ${over ? "text-red-600" : "text-gray-500"}`}
                    >
                      {usedPct}% of budget used
                    </p>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
