"use client";

import { fmtDate } from "@/components/project/format";
import { Badge } from "@/components/ui/Badge";
import { REASON_CODE_LABELS, type TaskRevision } from "@/types";

/**
 * Why this task is where it is.
 *
 * The `knock_on` distinction is the whole point of the panel. A row marked
 * "knock-on" was moved by the scheduler because something upstream moved, and
 * it carries the reason from the task that actually slipped — so six months
 * later the history says "this slipped because the steels were late", rather
 * than leaving a reader to work out which of eleven simultaneous movements was
 * the cause and which were the effects.
 */

const FIELD_LABELS: Record<string, string> = {
  planned_start: "Start",
  planned_end: "End",
  duration_days: "Duration",
  budget_amount: "Budget",
  status: "Status",
  progress_pct: "% complete",
};

// A date field shows as a date; a number shows as a number. Values are stored
// as text because the log is a record, not a calculation input.
function display(field: string, value: string | null): string {
  if (value === null) return "—";
  if (field === "planned_start" || field === "planned_end") return fmtDate(value);
  if (field === "duration_days") return `${value}d`;
  if (field === "budget_amount") return `£${Number(value).toFixed(2)}`;
  if (field === "progress_pct") return `${Number(value)}%`;
  return value;
}

export default function TaskHistory({
  revisions,
}: {
  revisions: TaskRevision[];
}) {
  if (revisions.length === 0)
    return <p className="muted">Nothing has changed since this was added.</p>;

  return (
    <ul className="space-y-2.5">
      {revisions.map((rev) => (
        <li key={rev.id} className="card">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.9375rem] font-semibold text-gray-900">
              {FIELD_LABELS[rev.field] ?? rev.field}
            </p>
            {rev.shift_source === "knock_on" ? (
              <Badge label="Knock-on" tone="warn" />
            ) : null}
          </div>

          <p className="tnum mt-1 text-sm text-gray-600">
            {display(rev.field, rev.old_value)} →{" "}
            <span className="font-semibold text-gray-900">
              {display(rev.field, rev.new_value)}
            </span>
          </p>

          {rev.reason_code || rev.reason_note ? (
            <p className="mt-1.5 text-[0.8125rem] leading-snug text-gray-600">
              {rev.reason_code ? (
                <span className="font-semibold">
                  {REASON_CODE_LABELS[rev.reason_code]}
                </span>
              ) : null}
              {rev.reason_code && rev.reason_note ? " — " : ""}
              {rev.reason_note}
            </p>
          ) : null}

          <p className="mt-1.5 text-xs text-gray-400">
            {new Date(rev.changed_at).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </li>
      ))}
    </ul>
  );
}
