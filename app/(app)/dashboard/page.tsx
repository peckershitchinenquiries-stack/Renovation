import { createClient } from "@/lib/supabase/server";
import {
  getExpiringCertifications,
  getPortfolio,
  getRetentionsDue,
} from "@/lib/data";
import { computeEntries } from "@/lib/calculations";
import {
  computePurchases,
  ACTIVE_PURCHASE,
  SPENDABLE_ENTRY,
} from "@/lib/purchases";
import DashboardScreen, {
  type ProjectSpend,
} from "@/components/project/DashboardScreen";
import type { Project, ExpenseEntry, Purchase, Payment } from "@/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const [
    { data: projects },
    { data: rawEntries },
    { data: rawPurchases },
    { data: rawPayments },
    portfolio,
    expiringCertifications,
    retentionsDue,
  ] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("expense_entries").select("*"),
    supabase.from("purchases").select("*").neq("entry_status", "Cancelled"),
    supabase.from("payments").select("*"),
    // The schedule half. Tolerated failing: migrations are applied by hand, so
    // on a database where 0016 has not been pasted in these tables genuinely do
    // not exist — and the money view of this screen worked perfectly well
    // before the schedule existed and must keep working.
    getPortfolio().catch(() => ({ healths: [], bundles: [] })),
    // The two Track B warnings. Both already tolerate their tables not
    // existing and return an empty list, so a database without 0019 or 0020
    // simply shows neither banner. The `.catch` is belt and braces.
    getExpiringCertifications().catch(() => []),
    getRetentionsDue().catch(() => []),
  ]);

  // One shared rule, so this card and the project's Overview cannot disagree —
  // see SPENDABLE_ENTRY in lib/purchases.ts for why the ledger side is excluded
  // and why the filter stays although that bucket is empty.
  const entries = computeEntries((rawEntries ?? []) as ExpenseEntry[]).filter(
    SPENDABLE_ENTRY
  );
  const spentByProject: Record<string, number> = {};
  const addSpend = (projectId: string, amount: number) => {
    spentByProject[projectId] = (spentByProject[projectId] ?? 0) + amount;
  };

  for (const e of entries) {
    if (e.status === "Cancelled") continue;
    addSpend(e.project_id, e.total_incl_vat);
  }

  const computedPurchases = computePurchases(
    (rawPurchases ?? []) as Purchase[],
    (rawPayments ?? []) as Payment[]
  ).filter(ACTIVE_PURCHASE);

  const invoicedByProject: Record<string, ProjectSpend> = {};
  for (const p of computedPurchases) {
    const existing =
      invoicedByProject[p.project_id] ??
      { gross: 0, paid: 0, balance: 0, count: 0 };
    existing.gross += Number(p.gross_total);
    existing.paid += p.paid;
    existing.balance += p.balance;
    existing.count += 1;
    invoicedByProject[p.project_id] = existing;
    // Invoices are spend. They used to be counted only in the separate
    // "Invoices" block below, which meant a project funded entirely by
    // invoices — every project, now the spreadsheet import has gone — showed
    // "Spent £0.00" next to a real invoice total. There is no double-count
    // risk: a purchase and an expense_entry are two different rows, and
    // nothing writes both for one payment.
    addSpend(p.project_id, Number(p.gross_total));
  }

  return (
    <DashboardScreen
      projects={(projects ?? []) as Project[]}
      spentByProject={spentByProject}
      invoicedByProject={invoicedByProject}
      healths={portfolio.healths}
      bundles={portfolio.bundles}
      expiringCertifications={expiringCertifications}
      retentionsDue={retentionsDue}
    />
  );
}
