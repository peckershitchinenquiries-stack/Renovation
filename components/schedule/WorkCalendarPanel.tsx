"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateWorkCalendar, hasErrors } from "@/lib/validation";
import { ISO_WEEKDAYS, describeWeekdays } from "@/lib/schedule";
import { fmtDate } from "@/components/project/format";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import type { ProjectHoliday, WorkCalendar } from "@/types";

/**
 * The working calendar — which days this job works, and which days it is shut.
 *
 * ---------------------------------------------------------------------------
 * Why this is on the Schedule tab and not on Edit project
 * ---------------------------------------------------------------------------
 * Everything here changes every date on the screen behind it. Put it on Edit
 * project and a reader ticks Saturday, saves, lands back on Overview and never
 * sees the fortnight that just came off the finish date. Here, the summary line
 * sits a few inches above the Gantt it governs and the panel reloads the whole
 * schedule on save, so the consequence is visible in the same glance as the
 * cause. It is also the only configuration in the app whose default is a
 * *guess about the job* rather than an absence, which is the other reason it has
 * to be visible rather than filed under settings.
 *
 * ---------------------------------------------------------------------------
 * Why the summary line always shows, even at the default
 * ---------------------------------------------------------------------------
 * `projects.working_weekdays` defaults to Monday–Friday and `project_holidays`
 * starts empty, and until 2026-10-01 neither could be changed from the app at
 * all — there was no form and no route, only the column default. So every
 * project in the app was silently scheduled as a five-day week with no bank
 * holidays, and the engine dutifully produced dates that were wrong by a day a
 * week for any job that worked a Saturday or stopped for Christmas. They looked
 * entirely plausible, which is exactly the failure about.md §16 warns about.
 *
 * A panel that hid itself when the calendar was "unset" would reproduce that
 * silence. "Mon–Fri · no non-working days" is a claim about the job, and this
 * line makes the app state it out loud so somebody can disagree with it.
 *
 * ---------------------------------------------------------------------------
 * Two writes, not one
 * ---------------------------------------------------------------------------
 * The weekday set is a column on `projects` and is saved by an explicit Save:
 * a half-ticked set must not reach the engine, and unticking everything is
 * invalid (no working days = a task that never ends), so it needs a moment of
 * validation before it goes. Holidays are rows and are added and removed one at
 * a time, immediately — a list where each line is its own record, and nothing is
 * lost if the sheet is closed mid-thought.
 */

// The weekday list and the "Mon–Fri" wording both come from lib/schedule.ts,
// beside `isoWeekday()` and the forward pass that act on the same numbers, and
// covered by lib/schedule.test.mts. A second copy here is how a label comes to
// disagree with the number it names.
const MON_FRI = [1, 2, 3, 4, 5];

const sorted = (days: number[]) => [...new Set(days)].sort((a, b) => a - b);
const sameDays = (a: number[], b: number[]) =>
  sorted(a).join(",") === sorted(b).join(",");

export default function WorkCalendarPanel({
  projectId,
  calendar,
  holidays,
  /** Reloads the schedule bundle — every date on screen depends on this. */
  onChanged,
}: {
  projectId: string;
  calendar: WorkCalendar;
  holidays: ProjectHoliday[];
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  const days = sorted(calendar.working_weekdays.map(Number));
  const isDefault = sameDays(days, MON_FRI) && holidays.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-gray-50 px-4 py-2.5 ring-1 ring-inset ring-gray-900/5">
        <Icon name="calendar" size={15} className="text-gray-400" />
        <p className="text-[0.8125rem] text-gray-600">
          Working{" "}
          <span className="font-semibold text-gray-900">
            {describeWeekdays(days)}
          </span>
          {" · "}
          {holidays.length === 0 ? (
            "no non-working days"
          ) : (
            <span className="font-semibold text-gray-900">
              {holidays.length} non-working{" "}
              {holidays.length === 1 ? "day" : "days"}
            </span>
          )}
          {/* Said out loud, because nobody set it — see the note at the top of
              this file. Every date on this tab is built on it. */}
          {isDefault ? (
            <span className="text-gray-400"> — the default, not checked</span>
          ) : null}
        </p>
        <button
          type="button"
          className="btn-ghost btn-sm ml-auto"
          onClick={() => setOpen(true)}
        >
          <Icon name="edit" size={14} />
          Calendar
        </button>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Working calendar"
        description="Every date on this tab counts working days only. Change this and they all move."
      >
        <CalendarEditor
          projectId={projectId}
          days={days}
          holidays={holidays}
          onChanged={onChanged}
        />
      </Sheet>
    </>
  );
}

function CalendarEditor({
  projectId,
  days,
  holidays,
  onChanged,
}: {
  projectId: string;
  days: number[];
  holidays: ProjectHoliday[];
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<number[]>(days);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingDays, setSavingDays] = useState(false);

  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const dirty = !sameDays(picked, days);

  const toggle = (iso: number) =>
    setPicked((current) =>
      current.includes(iso)
        ? current.filter((d) => d !== iso)
        : sorted([...current, iso])
    );

  async function saveDays() {
    const body = { working_weekdays: picked };
    const v = validateWorkCalendar(body);
    setErrors(v);
    if (hasErrors(v)) return;

    setSavingDays(true);
    try {
      await apiFetch(`/api/projects/${projectId}/schedule/calendar`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      // Says what actually happened, not "Saved". The dates moved; that is the
      // part worth telling somebody about.
      toast(`Working days set to ${describeWeekdays(picked)} — dates updated`, "success");
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSavingDays(false);
    }
  }

  async function addHoliday() {
    const body = { holiday_date: newDate, name: newName };
    setAddingHoliday(true);
    try {
      await apiFetch(`/api/projects/${projectId}/schedule/holidays`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNewDate("");
      setNewName("");
      setErrors({});
      toast("Non-working day added — dates updated", "success");
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setAddingHoliday(false);
    }
  }

  async function removeHoliday(id: string) {
    setRemoving(id);
    try {
      await apiFetch(`/api/projects/${projectId}/schedule/holidays/${id}`, {
        method: "DELETE",
      });
      toast("Back to a working day — dates updated", "success");
      await onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <p className="label">Days worked on this job</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ISO_WEEKDAYS.map((d) => {
            const on = picked.includes(d.iso);
            return (
              <button
                key={d.iso}
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={d.long}
                onClick={() => toggle(d.iso)}
                className={`min-w-[3.25rem] rounded-xl px-3 py-2 text-[0.8125rem] font-semibold ring-1 ring-inset transition ${
                  on
                    ? "bg-brand-600 text-white ring-brand-700"
                    : "bg-white text-gray-500 ring-gray-900/10 hover:text-gray-900"
                }`}
              >
                {d.short}
              </button>
            );
          })}
        </div>
        {errors.working_weekdays ? (
          <p className="field-error">{errors.working_weekdays}</p>
        ) : (
          <p className="hint">
            A plasterer does not work Sunday. A job that genuinely runs Saturdays
            ticks Sat and every bar on the chart gets shorter.
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!dirty || savingDays}
            onClick={saveDays}
          >
            {savingDays ? <Spinner /> : null}
            Save working days
          </button>
          {dirty ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={savingDays}
              onClick={() => {
                setPicked(days);
                setErrors({});
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      </section>

      <section className="border-t border-gray-200/70 pt-4">
        <p className="label">Days the site is shut</p>
        <p className="hint">
          Bank holidays, the Christmas shutdown, a week nobody is on site. Work
          skips over them, so adding one pushes everything after it later.
        </p>

        {holidays.length > 0 ? (
          <ul className="mt-2.5 divide-y divide-gray-200/70">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center gap-3 py-2 text-[0.8125rem]"
              >
                <span className="font-semibold text-gray-900">
                  {fmtDate(h.holiday_date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-500">
                  {h.name ?? "—"}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  aria-label={`Remove ${h.name ?? h.holiday_date}`}
                  disabled={removing === h.id}
                  onClick={() => removeHoliday(h.id)}
                >
                  {removing === h.id ? (
                    <Spinner />
                  ) : (
                    <Icon name="trash" size={14} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[0.8125rem] text-gray-400">
            None yet — the job runs straight through every bank holiday.
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr_auto]">
          <DatePicker
            title="Non-working day"
            placeholder="Pick a date"
            invalid={Boolean(errors.holiday_date)}
            value={newDate}
            onChange={setNewDate}
          />
          <input
            className={`input ${errors.name ? "input-invalid" : ""}`}
            maxLength={120}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="What it is — e.g. Boxing Day"
            aria-label="What the day is"
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={!newDate || addingHoliday}
            onClick={addHoliday}
          >
            {addingHoliday ? <Spinner /> : <Icon name="plus" size={15} />}
            Add
          </button>
        </div>
        {errors.holiday_date ? (
          <p className="field-error">{errors.holiday_date}</p>
        ) : null}
        {errors.name ? <p className="field-error">{errors.name}</p> : null}
      </section>
    </div>
  );
}
