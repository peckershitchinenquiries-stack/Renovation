import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeEntries, formatCurrency } from "@/lib/calculations";
import { computePurchases, ACTIVE_PURCHASE } from "@/lib/purchases";
import { MONEY, BUDGET } from "@/lib/vocabulary";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { HeroStat } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { Fab } from "@/components/ui/Fab";
import type { Project, ExpenseEntry, Purchase, Payment } from "@/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const [
    { data: projects },
    { data: rawEntries },
    { data: rawPurchases },
    { data: rawPayments },
  ] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("expense_entries").select("*"),
    supabase.from("purchases").select("*").neq("entry_status", "Cancelled"),
    supabase.from("payments").select("*"),
  ]);

  // 'ledger' rows are the imported reference set that overlapped the diary, so
  // they are excluded — summing both double-counts the same spend (about.md
  // §5). Mirrors the filter in ProjectDetail.tsx so this card and the project's
  // Overview agree.
  const entries = computeEntries((rawEntries ?? []) as ExpenseEntry[]).filter(
    (e) => e.source !== "ledger"
  );
  const spentByProject = new Map<string, number>();
  const addSpend = (projectId: string, amount: number) =>
    spentByProject.set(projectId, (spentByProject.get(projectId) ?? 0) + amount);

  for (const e of entries) {
    if (e.status === "Cancelled") continue;
    addSpend(e.project_id, e.total_incl_vat);
  }

  const computedPurchases = computePurchases(
    (rawPurchases ?? []) as Purchase[],
    (rawPayments ?? []) as Payment[]
  ).filter(ACTIVE_PURCHASE);

  const invoicedByProject = new Map<string, { gross: number; paid: number; balance: number; count: number }>();
  for (const p of computedPurchases) {
    const existing = invoicedByProject.get(p.project_id) ?? { gross: 0, paid: 0, balance: 0, count: 0 };
    existing.gross += Number(p.gross_total);
    existing.paid += p.paid;
    existing.balance += p.balance;
    existing.count += 1;
    invoicedByProject.set(p.project_id, existing);
    // Invoices are spend. They used to be counted only in the separate
    // "Invoices" block below, which meant a project funded entirely by
    // invoices — every project, now the spreadsheet import has gone — showed
    // "Spent £0.00" next to a real invoice total. There is no double-count
    // risk: a purchase and an expense_entry are two different rows, and
    // nothing writes both for one payment.
    addSpend(p.project_id, Number(p.gross_total));
  }

  const list = (projects ?? []) as Project[];

  // Portfolio roll-up for the hero. Same figures as the cards below, summed —
  // so the top of the screen answers "where am I overall" before the reader
  // has to compare cards to work it out themselves.
  const totalCost = list.reduce((sum, p) => sum + (spentByProject.get(p.id) ?? 0), 0);
  const totalOwed = list.reduce(
    (sum, p) => sum + (invoicedByProject.get(p.id)?.balance ?? 0),
    0
  );
  const activeCount = list.filter((p) => p.status === "active").length;

  return (
    <div>
      <PageHeader
        title="Home"
        subtitle={
          list.length === 0
            ? "No projects yet"
            : `${list.length} ${list.length === 1 ? "project" : "projects"}${
                activeCount ? ` · ${activeCount} active` : ""
              }`
        }
        flush
        action={
          <Link href="/projects/new" className="btn-primary btn-sm hidden sm:inline-flex">
            <Icon name="plus" size={16} strokeWidth={2.25} />
            New project
          </Link>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon="home"
          title="No projects yet"
          description="Create your first renovation project to start tracking costs."
          action={
            <Link href="/projects/new" className="btn-primary">
              <Icon name="plus" size={18} strokeWidth={2.25} />
              Create project
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          <HeroStat
            label={`Total ${MONEY.cost.label.toLowerCase()} across all projects`}
            value={formatCurrency(totalCost)}
            sub={
              totalOwed > 0.001 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                  {formatCurrency(totalOwed)} still {MONEY.owed.label.toLowerCase()} on
                  invoices
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  Every invoice settled
                </span>
              )
            }
          />

          <section>
            <SectionHeader
              title="Projects"
              hint={`${MONEY.cost.hint}, including invoices`}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  spent={spentByProject.get(p.id) ?? 0}
                  invoices={invoicedByProject.get(p.id)}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      <Fab href="/projects/new" label="New project" />
    </div>
  );
}

function ProjectCard({
  project,
  spent,
  invoices,
}: {
  project: Project;
  spent: number;
  invoices?: { gross: number; paid: number; balance: number; count: number };
}) {
  const budget = Number(project.target_budget);
  const usedPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const over = budget > 0 && spent > budget;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="card block transition active:scale-[0.99] hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold tracking-[-0.01em] text-gray-900">
          {project.name}
        </h3>
        <Badge label={project.status} />
      </div>

      {/* The cost is the reason the card exists, so it is the biggest thing on
          it. "Spent" was this card's own word for what every other screen now
          calls Cost — same figure, same word. */}
      <p className="tnum mt-3 text-2xl font-bold leading-none tracking-[-0.02em] text-gray-900">
        {formatCurrency(spent)}
      </p>
      <p className="mt-1 text-xs text-gray-500">{MONEY.cost.label} to date</p>

      {budget > 0 ? (
        <div className="mt-3.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all ${
                over ? "bg-red-500" : usedPct > 85 ? "bg-amber-500" : "bg-brand"
              }`}
              style={{ width: `${Math.min(Math.max(usedPct, 2), 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className={over ? "font-semibold text-red-600" : "text-gray-500"}>
              {usedPct}% of {BUDGET.label.toLowerCase()}
            </span>
            <span className="tnum text-gray-400">{formatCurrency(budget)}</span>
          </div>
        </div>
      ) : null}

      {invoices && invoices.count > 0 ? (
        <div className="mt-3.5 border-t border-gray-200/70 pt-3">
          {/* Explicitly a subset of the Cost above, not a second pot — the card
              used to print "Invoiced" next to "Spent" with no hint that one
              contained the other. */}
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-gray-400">
            Of that, on {invoices.count}{" "}
            {invoices.count === 1 ? "invoice" : "invoices"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <MiniFigure label={MONEY.paid.label} value={formatCurrency(invoices.paid)} />
            <MiniFigure
              label={MONEY.owed.label}
              value={formatCurrency(invoices.balance)}
              tone={invoices.balance > 0.001 ? "bad" : "good"}
            />
            <MiniFigure label={MONEY.cost.label} value={formatCurrency(invoices.gross)} />
          </div>
        </div>
      ) : null}
    </Link>
  );
}

function MiniFigure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="min-w-0">
      <span className="block truncate text-2xs font-medium text-gray-400">
        {label}
      </span>
      <span
        className={`tnum block truncate text-[0.8125rem] font-bold ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-emerald-600"
              : "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
