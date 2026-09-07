"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import {
  DEP_TYPES,
  DEP_TYPE_LABELS,
  type DepType,
  type Task,
  type TaskDependency,
} from "@/types";

/**
 * What has to happen before this task can start.
 *
 * Links are edited from the SUCCESSOR's side — "what am I waiting on" — rather
 * than from the predecessor's, because that is how the question is asked on
 * site. The plasterer is waiting on the first fix; nobody thinks of the first
 * fix as having a plasterer attached to it.
 *
 * The loop check is on the server (the route runs `detectCycle` against the
 * graph that WOULD exist), so this component simply shows the message it sends
 * back — which names the tasks in the loop, not just "invalid".
 */
export default function DependencyEditor({
  projectId,
  task,
  tasks,
  dependencies,
  onChanged,
}: {
  projectId: string;
  task: Task;
  tasks: Task[];
  dependencies: TaskDependency[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [predecessor, setPredecessor] = useState("");
  const [depType, setDepType] = useState<DepType>("FS");
  const [lag, setLag] = useState("0");
  // Migration 0020. Off by default: most links are just "this follows that",
  // and a schedule where every step demands a signature stops moving.
  const [requiresSignoff, setRequiresSignoff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameById = new Map(tasks.map((t) => [t.id, t.name]));
  const mine = dependencies.filter((d) => d.successor_id === task.id);
  const linked = new Set(mine.map((d) => d.predecessor_id));

  // Offering the task itself would be refused by a CHECK constraint; offering
  // one it is already linked to would be refused by a unique index. Neither
  // needs to reach the server to be known.
  const options = tasks
    .filter((t) => t.id !== task.id && !linked.has(t.id))
    .map((t) => ({ value: t.id, label: t.name, hint: t.trade ?? undefined }));

  async function add() {
    if (!predecessor) {
      setError("Pick the task that comes first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/schedule/dependencies`, {
        method: "POST",
        body: JSON.stringify({
          predecessor_id: predecessor,
          successor_id: task.id,
          dep_type: depType,
          lag_days: Number(lag) || 0,
          requires_signoff: requiresSignoff,
        }),
      });
      setPredecessor("");
      setLag("0");
      setDepType("FS");
      setRequiresSignoff(false);
      onChanged();
    } catch (err) {
      // The route's message already names the loop when there is one, which is
      // the only thing worth reading here.
      const message =
        err instanceof ApiError ? err.message : "Could not add that link";
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(
        `/api/projects/${projectId}/schedule/dependencies/${id}`,
        { method: "DELETE" }
      );
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove", "error");
    }
  }

  return (
    <div className="space-y-3">
      {mine.length > 0 ? (
        <ul className="card-flush row-divide">
          {mine.map((dep) => (
            <li key={dep.id} className="flex items-center gap-3 px-4 py-3">
              <Icon name="link" size={16} className="shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-semibold text-gray-900">
                  {nameById.get(dep.predecessor_id) ?? "Unknown task"}
                </span>
                <span className="mt-0.5 block text-[0.8125rem] text-gray-500">
                  {DEP_TYPE_LABELS[dep.dep_type]}
                  {dep.lag_days
                    ? dep.lag_days > 0
                      ? ` · ${dep.lag_days}d wait`
                      : ` · ${Math.abs(dep.lag_days)}d overlap`
                    : ""}
                  {dep.requires_signoff ? (
                    <span className="font-semibold text-amber-700">
                      {" "}
                      · needs sign-off
                    </span>
                  ) : null}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(dep.id)}
                aria-label="Remove link"
                className="btn-icon shrink-0 text-gray-400 hover:text-red-600"
              >
                <Icon name="close" size={17} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Nothing has to finish before this starts.
        </p>
      )}

      {options.length > 0 ? (
        <div className="card-sunken space-y-3">
          <div>
            <label className="label" htmlFor="dep-predecessor">
              Waits for
            </label>
            <Select
              id="dep-predecessor"
              title="Which task comes first?"
              placeholder="Pick a task"
              invalid={Boolean(error)}
              value={predecessor}
              onChange={(v) => {
                setPredecessor(v);
                setError(null);
              }}
              options={options}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="dep-type">
                Link
              </label>
              <Select
                id="dep-type"
                title="Link type"
                value={depType}
                onChange={(v) => setDepType(v as DepType)}
                options={DEP_TYPES.map((t) => ({
                  value: t,
                  label: DEP_TYPE_LABELS[t],
                }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="dep-lag">
                Wait (days)
              </label>
              <input
                id="dep-lag"
                type="number"
                inputMode="numeric"
                className="input tnum"
                value={lag}
                onChange={(e) => setLag(e.target.value)}
              />
            </div>
          </div>
          {error ? <p className="field-error">{error}</p> : null}
          <p className="hint">
            A negative wait is an overlap — start the plasterer two days before
            the first fix is finished.
          </p>

          {/* Migration 0020. This is the difference between a schedule and a
              process: "the plasterer can't start until first fix is SIGNED
              OFF" is not the same constraint as "until first fix finishes". */}
          <label className="flex items-start gap-3 rounded-xl bg-white p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
              checked={requiresSignoff}
              onChange={(e) => setRequiresSignoff(e.target.checked)}
            />
            <span className="text-[0.8125rem] leading-relaxed text-gray-700">
              <span className="font-semibold text-gray-900">
                Needs sign-off, not just finishing
              </span>
              <br />
              This task stays <strong>Blocked</strong> until the one before it
              is complete <em>and</em> signed off.
            </span>
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={add}
            className="btn-secondary btn-sm w-full"
          >
            {saving ? <Spinner /> : <Icon name="plus" size={15} strokeWidth={2.25} />}
            Add link
          </button>
        </div>
      ) : null}
    </div>
  );
}
