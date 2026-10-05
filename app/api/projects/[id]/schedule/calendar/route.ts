import { requireUser, json, error } from "@/lib/api";
import { validateWorkCalendar, hasErrors } from "@/lib/validation";
import type { WorkCalendarInput } from "@/types";

/**
 * Which weekdays this job works (migration 0018).
 *
 * `projects.working_weekdays` and `project_holidays` drive every date the
 * scheduling engine produces — the forward pass, the backward pass, float, the
 * "days behind" chip and the portfolio Gantt all count WORKING days, not
 * calendar days. Until this route existed neither could be set from the app at
 * all: the column had a default of Monday–Friday and the only way to change it
 * was to write SQL by hand. A Saturday-working crew, a Christmas shutdown or a
 * single bank holiday therefore produced dates that were wrong by a day a week
 * and looked entirely plausible, which is the failure about.md §16 warns about.
 *
 * Deliberately its own route rather than more fields on `PATCH /api/projects`.
 * That route is the project's identity — name, budget, status, dates. This is
 * the schedule's configuration, it sits beside the other `schedule/*` writes,
 * and it is the only PATCH in the app where saving changes every date on the
 * screen that called it.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as WorkCalendarInput;
  const errors = validateWorkCalendar(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  // Sorted and de-duplicated before it goes in. The CHECK does not require an
  // order, but a stored `{5,1,3}` would render as "Fri, Mon, Wed" everywhere it
  // is read, and every reader would then have to sort it for itself.
  const working_weekdays = [...new Set(body.working_weekdays.map(Number))].sort(
    (a, b) => a - b
  );

  const { data, error: dbError } = await auth.supabase
    .from("projects")
    .update({ working_weekdays })
    .eq("id", params.id)
    .select()
    .single();

  // 42703 is "column does not exist" — 0018 has not been pasted into the SQL
  // editor yet. Naming the file beats a raw Postgres message, which reads as a
  // bug in the form. Same courtesy the phase and task routes extend for 0016.
  if (dbError?.code === "42703")
    return error(
      "The working calendar is not installed — run 0018_work_calendar.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);
  if (!data) return error("Project not found", 404);

  return json(data);
}
