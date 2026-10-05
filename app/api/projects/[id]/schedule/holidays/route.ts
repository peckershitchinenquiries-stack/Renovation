import { requireUser, json, error } from "@/lib/api";
import { validateHoliday, hasErrors } from "@/lib/validation";
import type { HolidayInput } from "@/types";

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * Add a day the site is shut (migration 0018).
 *
 * Bank holidays, the Christmas shutdown, a week the owner is away. One row per
 * date per project — see the migration for why there is no shared national
 * calendar — and the scheduling engine simply skips them when counting working
 * days. Adding one moves every date that follows it.
 *
 * `name` is optional and is only ever a label. Nothing reads it but the panel
 * that lists them, which is the point: a list of bare dates is unmaintainable
 * because nobody can tell a bank holiday from a mistake six months later.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as HolidayInput;
  const errors = validateHoliday(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  const { data, error: dbError } = await auth.supabase
    .from("project_holidays")
    .insert({
      user_id: auth.user.id,
      project_id: params.id,
      holiday_date: String(body.holiday_date).trim(),
      name: text(body.name),
    })
    .select()
    .single();

  // 23505 is the unique index on (project_id, holiday_date). Adding Christmas
  // Day twice is a mistake, not two holidays — said under the date field rather
  // than as a 500, so the form can point at the thing that is wrong.
  if (dbError?.code === "23505")
    return error("That date is already a non-working day", 422, {
      holiday_date: "Already on the list",
    });
  if (dbError?.code === "42P01")
    return error(
      "The working calendar is not installed — run 0018_work_calendar.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
