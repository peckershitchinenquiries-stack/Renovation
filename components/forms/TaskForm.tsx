"use client";

import { useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateTask, hasErrors } from "@/lib/validation";
import { formatCurrency } from "@/lib/calculations";
import { BUDGET } from "@/lib/vocabulary";
import {
  endFromDuration,
  inclusiveWorkingDays,
  isISODate,
} from "@/lib/schedule";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import TradeSelect from "@/components/forms/TradeSelect";
import {
  REASON_CODES,
  REASON_CODE_LABELS,
  TASK_STATUSES,
  type Contact,
  type ProjectPhase,
  type Task,
  type TradeLookup,
  type WorkCalendar,
} from "@/types";

/**
 * Add or edit one piece of work.
 *
 * Two things here are not obvious from the field list:
 *
 * **Duration and dates are shown together, and the duration wins.** That is the
 * schedule's governing rule (about.md §15) and the form makes it visible rather
 * than surprising: typing a duration moves the end date in front of you, and
 * typing an end date fills the duration in. Neither silently overrides the
 * other later.
 *
 * **The reason prompt appears the moment a baselined date moves**, and the save
 * is refused without it — the server enforces the same rule, so the two cannot
 * drift. A revision log that is optional is a log everybody skips, and a log
 * everybody skipped answers no question at all six months later.
 */

interface Props {
  projectId: string;
  phases: ProjectPhase[];
  trades: TradeLookup[];
  calendar: WorkCalendar;
  /** The people register (migration 0020). Empty when 0020 has not been run. */
  contacts?: Contact[];
  task?: Task;
  /** True when this task has a baseline to move away from. Drives the prompt. */
  baselined?: boolean;
  /** Preselects the phase when adding from inside a phase group. */
  defaultPhaseId?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

export default function TaskForm({
  projectId,
  phases,
  trades,
  calendar,
  contacts = [],
  task,
  baselined = false,
  defaultPhaseId = null,
  onSaved,
  onCancel,
}: Props) {
  const toast = useToast();
  const editing = Boolean(task);

  const [form, setForm] = useState(() => ({
    phase_id: task?.phase_id ?? defaultPhaseId ?? "",
    name: task?.name ?? "",
    trade: task?.trade ?? "",
    assignee_contact_id: task?.assignee_contact_id ?? "",
    planned_start: task?.planned_start ?? "",
    planned_end: task?.planned_end ?? "",
    actual_start: task?.actual_start ?? "",
    actual_end: task?.actual_end ?? "",
    duration_days: task?.duration_days?.toString() ?? "",
    progress_pct: task?.progress_pct?.toString() ?? "0",
    status: task?.status ?? "Not started",
    budget_amount: task?.budget_amount?.toString() ?? "",
    weather_sensitive: task?.weather_sensitive ?? false,
    lead_time_days: task?.lead_time_days?.toString() ?? "",
    hire_daily_rate: task?.hire_daily_rate?.toString() ?? "",
    notes: task?.notes ?? "",
    reason_code: "",
    reason_note: "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tradeList, setTradeList] = useState<TradeLookup[]>(trades);
  const [showMore, setShowMore] = useState(
    Boolean(
      task &&
        (task.actual_start ||
          task.actual_end ||
          task.lead_time_days ||
          task.hire_daily_rate ||
          task.weather_sensitive ||
          task.notes)
    )
  );

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  /** Typing a duration moves the end date, in WORKING days. */
  function setDuration(value: string) {
    setForm((f) => {
      const next = { ...f, duration_days: value };
      const days = Number(value);
      if (isISODate(f.planned_start) && Number.isInteger(days) && days > 0)
        next.planned_end = endFromDuration(f.planned_start, days, calendar);
      return next;
    });
  }

  /** Typing an end date fills the duration in, so the two never disagree. */
  function setEnd(value: string) {
    setForm((f) => {
      const next = { ...f, planned_end: value };
      if (isISODate(f.planned_start) && isISODate(value))
        next.duration_days = String(
          inclusiveWorkingDays(f.planned_start, value, calendar)
        );
      return next;
    });
  }

  function setStart(value: string) {
    setForm((f) => {
      const next = { ...f, planned_start: value };
      const days = Number(f.duration_days);
      if (isISODate(value) && Number.isInteger(days) && days > 0)
        next.planned_end = endFromDuration(value, days, calendar);
      return next;
    });
  }

  // Did this edit move a bar? Only then is a reason asked for, and only on a
  // task that has a baseline — before that there is nothing to explain.
  const movedDates = useMemo(() => {
    if (!editing || !task) return false;
    return (
      (task.planned_start ?? "") !== form.planned_start ||
      (task.planned_end ?? "") !== form.planned_end ||
      String(task.duration_days ?? "") !== form.duration_days
    );
  }, [editing, task, form.planned_start, form.planned_end, form.duration_days]);

  const needsReason = movedDates && baselined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateTask(form);
    if (needsReason && !form.reason_code) v.reason_code = "Why did this move?";
    if (needsReason && form.reason_code === "other" && !form.reason_note.trim())
      v.reason_note = "Say what happened";
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(
        editing
          ? `/api/projects/${projectId}/schedule/tasks/${task!.id}`
          : `/api/projects/${projectId}/schedule/tasks`,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(form),
        }
      );
      toast(editing ? "Task updated" : "Task added", "success");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="task-name">
          What is the work? <span className="text-red-500">*</span>
        </label>
        <input
          id="task-name"
          className={`input ${errors.name ? "input-invalid" : ""}`}
          maxLength={200}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. First fix electrics"
        />
        {errors.name && <p className="field-error">{errors.name}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="task-phase">
            Phase
          </label>
          <Select
            id="task-phase"
            title="Phase"
            placeholder="Unphased"
            clearable
            value={form.phase_id}
            onChange={(v) => set("phase_id", v)}
            options={phases.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="task-trade">
            Trade
          </label>
          <TradeSelect
            id="task-trade"
            value={form.trade}
            trades={tradeList}
            onChange={(name) => set("trade", name)}
            onTradeAdded={(t) => setTradeList((list) => [...list, t])}
          />
        </div>
      </div>

      {/* Who is doing it (migration 0020).
          Only rendered once there is a register to pick from — an empty
          dropdown next to a filled-in trade reads as a broken field. The
          person's day rate is what the Gantt's cost-impact chip prefers when
          this task is dragged out; with nobody assigned it falls back to the
          trade default and says which it used. */}
      {contacts.length > 0 ? (
        <div>
          <label className="label" htmlFor="task-assignee">
            Assigned to
          </label>
          <Select
            id="task-assignee"
            title="Who is doing this"
            placeholder="Nobody yet"
            clearable
            value={form.assignee_contact_id}
            onChange={(v) => set("assignee_contact_id", v)}
            options={contacts
              .filter(
                // Inactive people stay pickable only if they are already on
                // this task — otherwise removing somebody from the job would
                // blank the assignee on work they actually did.
                (c) =>
                  c.status === "active" || c.id === task?.assignee_contact_id
              )
              .map((c) => ({
                value: c.id,
                label: c.name,
                hint:
                  [
                    c.trades.join(", ") || null,
                    c.day_rate !== null ? `£${c.day_rate}/day` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined,
              }))}
          />
        </div>
      ) : null}

      {/* Dates and duration, together — because they are one fact expressed two
          ways and keeping them apart is what lets them disagree. */}
      <fieldset className="card-sunken">
        <legend className="eyebrow mb-2.5">Planned</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="task-start">
              Start
            </label>
            <DatePicker
              id="task-start"
              title="Planned start"
              placeholder="Not scheduled"
              value={form.planned_start}
              onChange={setStart}
            />
            {errors.planned_start && (
              <p className="field-error">{errors.planned_start}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="task-end">
              End
            </label>
            <DatePicker
              id="task-end"
              title="Planned end"
              placeholder="Not scheduled"
              value={form.planned_end}
              onChange={setEnd}
            />
            {errors.planned_end && (
              <p className="field-error">{errors.planned_end}</p>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="task-duration">
              Working days
            </label>
            <input
              id="task-duration"
              type="number"
              inputMode="numeric"
              min={1}
              className={`input tnum ${errors.duration_days ? "input-invalid" : ""}`}
              value={form.duration_days}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="1"
            />
            {errors.duration_days && (
              <p className="field-error">{errors.duration_days}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="task-progress">
              % complete
            </label>
            <input
              id="task-progress"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="5"
              className={`input tnum ${errors.progress_pct ? "input-invalid" : ""}`}
              value={form.progress_pct}
              onChange={(e) => set("progress_pct", e.target.value)}
            />
            {errors.progress_pct && (
              <p className="field-error">{errors.progress_pct}</p>
            )}
          </div>
        </div>

        <p className="hint">
          Working days only — weekends and the project&rsquo;s holidays are
          skipped. The duration is what counts: change it and the end date
          follows.
        </p>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="task-status">
            Status <span className="text-red-500">*</span>
          </label>
          <Select
            id="task-status"
            title="Status"
            value={form.status}
            onChange={(v) => set("status", v)}
            options={TASK_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="task-budget">
            {BUDGET.label} (ex VAT)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-gray-400">
              £
            </span>
            <input
              id="task-budget"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              className={`input tnum pl-8 ${
                errors.budget_amount ? "input-invalid" : ""
              }`}
              value={form.budget_amount}
              onChange={(e) => set("budget_amount", e.target.value)}
            />
          </div>
          {errors.budget_amount ? (
            <p className="field-error">{errors.budget_amount}</p>
          ) : (
            // Said here, at the field, because getting this wrong reports a
            // 20% overrun on a task that is exactly on budget.
            <p className="hint">
              Ex VAT, so it compares like-for-like with the net on your invoice
              lines.
            </p>
          )}
        </div>
      </div>

      {/* The reason gate. It appears only when it applies, and when it applies
          the form will not save without it. */}
      {needsReason && (
        <fieldset className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <legend className="eyebrow mb-2.5 text-amber-800">
            This moves a baselined date
          </legend>
          <div>
            <label className="label text-amber-900" htmlFor="task-reason">
              Why? <span className="text-red-500">*</span>
            </label>
            <Select
              id="task-reason"
              title="Reason"
              placeholder="Pick a reason"
              invalid={Boolean(errors.reason_code)}
              value={form.reason_code}
              onChange={(v) => set("reason_code", v)}
              options={REASON_CODES.map((c) => ({
                value: c,
                label: REASON_CODE_LABELS[c],
              }))}
            />
            {errors.reason_code && (
              <p className="field-error">{errors.reason_code}</p>
            )}
          </div>
          <div className="mt-3">
            <label className="label text-amber-900" htmlFor="task-reason-note">
              Note {form.reason_code === "other" ? "" : "(optional)"}
            </label>
            <input
              id="task-reason-note"
              className={`input ${errors.reason_note ? "input-invalid" : ""}`}
              value={form.reason_note}
              onChange={(e) => set("reason_note", e.target.value)}
              placeholder="e.g. steels arrived a week late"
            />
            {errors.reason_note && (
              <p className="field-error">{errors.reason_note}</p>
            )}
          </div>
        </fieldset>
      )}

      <button
        type="button"
        onClick={() => setShowMore((s) => !s)}
        aria-expanded={showMore}
        className="flex min-h-touch w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 text-left text-sm font-semibold text-gray-700 shadow-card transition active:bg-gray-50"
      >
        <span>Actual dates, lead time, hire rate &amp; notes</span>
        <Icon
          name={showMore ? "chevronUp" : "chevronDown"}
          size={18}
          className="shrink-0 text-gray-400"
        />
      </button>

      {showMore && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="task-actual-start">
                Actually started
              </label>
              <DatePicker
                id="task-actual-start"
                title="Actual start"
                placeholder="Not started"
                value={form.actual_start}
                onChange={(v) => set("actual_start", v)}
              />
            </div>
            <div>
              <label className="label" htmlFor="task-actual-end">
                Actually finished
              </label>
              <DatePicker
                id="task-actual-end"
                title="Actual end"
                placeholder="Not finished"
                value={form.actual_end}
                onChange={(v) => set("actual_end", v)}
              />
              {errors.actual_end && (
                <p className="field-error">{errors.actual_end}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="task-lead">
                Lead time (days)
              </label>
              <input
                id="task-lead"
                type="number"
                inputMode="numeric"
                min={0}
                className="input tnum"
                value={form.lead_time_days}
                onChange={(e) => set("lead_time_days", e.target.value)}
                placeholder="e.g. 28"
              />
              <p className="hint">
                How far ahead this has to be ordered. The dashboard warns you
                when the order-by date is a fortnight away.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="task-hire">
                Hire rate (£/day)
              </label>
              <input
                id="task-hire"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="input tnum"
                value={form.hire_daily_rate}
                onChange={(e) => set("hire_daily_rate", e.target.value)}
                placeholder="e.g. 60"
              />
              <p className="hint">
                Scaffold, plant, a skip on hire. Used to price a delay.
              </p>
            </div>
          </div>

          <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-card">
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-gray-300 text-brand focus:ring-brand/20"
              checked={form.weather_sensitive}
              onChange={(e) => set("weather_sensitive", e.target.checked)}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-800">
                Weather dependent
              </span>
              <span className="block text-xs text-gray-500">
                Roofing, groundworks, anything outside
              </span>
            </span>
          </label>

          <div>
            <label className="label" htmlFor="task-notes">
              Notes
            </label>
            <textarea
              id="task-notes"
              className="textarea"
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>
      )}

      {Number(form.budget_amount) > 0 ? (
        <p className="text-center text-xs text-gray-500">
          {BUDGET.label} {formatCurrency(Number(form.budget_amount))} ex VAT over{" "}
          {form.duration_days || 1} working{" "}
          {Number(form.duration_days) === 1 ? "day" : "days"}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {editing ? "Save changes" : "Add task"}
        </button>
      </div>
    </form>
  );
}
