"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { StatCard } from "@/components/ui/StatCard";
import { WeeklySpendChart } from "@/components/charts/WeeklySpendChart";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import { useToast } from "@/components/ui/Toast";
import type {
  ProjectSummary,
  WeekTotal,
  CategoryTotal,
  ProjectWeek,
} from "@/types";

export default function OverviewTab({
  summary,
  byWeek,
  byCategory,
  projectId,
  onWeekUpdated,
}: {
  summary: ProjectSummary;
  byWeek: WeekTotal[];
  byCategory: CategoryTotal[];
  projectId: string;
  onWeekUpdated: (w: ProjectWeek) => void;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  async function saveCompletion(week: number) {
    const value = Number(drafts[week]);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      toast("Completion must be 0–100", "error");
      return;
    }
    try {
      const saved = await apiFetch<ProjectWeek>(
        `/api/projects/${projectId}/weeks`,
        {
          method: "PATCH",
          body: JSON.stringify({ week_number: week, completion_pct: value }),
        }
      );
      onWeekUpdated(saved);
      toast(`Week ${week} completion saved`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.target_budget > 0 && (
          <StatCard
            label="Target Budget"
            value={formatCurrency(summary.target_budget)}
          />
        )}
        <StatCard
          label="Total Quoted"
          value={formatCurrency(summary.total_quoted)}
        />
        <StatCard
          label="Actual Total"
          value={formatCurrency(summary.forecast_total)}
        />
        <StatCard
          label="Variance vs Quote"
          value={formatCurrency(summary.variance)}
          tone={summary.variance > 0 ? "bad" : "good"}
          hint={summary.variance > 0 ? "Over quote" : "Within quote"}
        />
        <StatCard
          label="Paid to Date"
          value={formatCurrency(summary.paid_to_date)}
        />
        <StatCard
          label="Remaining to Pay"
          value={formatCurrency(summary.remaining_to_pay)}
        />
        <StatCard label="Weeks Tracked" value={String(summary.weeks_tracked)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Weekly Spend
          </h3>
          <WeeklySpendChart data={byWeek} />
        </div>
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Labour vs Materials
          </h3>
          <CategoryDonut data={byCategory} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Week-by-Week
        </h3>
        {byWeek.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            No expenses logged yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2">Week</th>
                <th className="py-2">Labour</th>
                <th className="py-2">Materials</th>
                <th className="py-2">VAT</th>
                <th className="py-2">Total</th>
                <th className="py-2">Completion %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byWeek.map((w) => (
                <tr key={w.week_number}>
                  <td className="py-2 font-medium">W{w.week_number}</td>
                  <td className="py-2">{formatCurrency(w.labour)}</td>
                  <td className="py-2">{formatCurrency(w.materials)}</td>
                  <td className="py-2">{formatCurrency(w.vat)}</td>
                  <td className="py-2 font-medium">{formatCurrency(w.total)}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        aria-label={`Week ${w.week_number} completion %`}
                        className="input h-9 w-20 py-1"
                        defaultValue={w.completion_pct}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [w.week_number]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="text-xs text-brand hover:underline"
                        onClick={() => saveCompletion(w.week_number)}
                      >
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
