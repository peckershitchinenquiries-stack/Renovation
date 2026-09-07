import { requireUser, json, error } from "@/lib/api";
import { getScheduleBundle } from "@/lib/data";
import { scheduleProject } from "@/lib/schedule";

/**
 * The whole schedule for one project, already scheduled.
 *
 * Returns the raw bundle AND the computed result together. The client could
 * run `scheduleProject` itself — it is pure and it does exactly that for the
 * "what if" scenario mode — but a first paint that shows the wrong dates for a
 * frame is worse than a slightly larger reply, and the two are computed by the
 * same function either way.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const bundle = await getScheduleBundle(params.id);
  if (!bundle) return error("Project not found", 404);

  return json({ bundle, schedule: scheduleProject(bundle) });
}
