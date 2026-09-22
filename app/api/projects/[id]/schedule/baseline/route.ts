import { requireUser, json, error } from "@/lib/api";
import { getScheduleBundle } from "@/lib/data";
import { scheduleProject } from "@/lib/schedule";
import type { Task, TaskBaseline } from "@/types";

/** The current baseline set — the most recently captured one. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data } = await auth.supabase
    .from("task_baselines")
    .select("*")
    .eq("project_id", params.id)
    .order("captured_at", { ascending: false });

  const rows = (data ?? []) as TaskBaseline[];
  const name = rows[0]?.baseline_name ?? null;
  return json({
    baseline_name: name,
    rows: name ? rows.filter((r) => r.baseline_name === name) : [],
  });
}

/**
 * Capture a baseline: freeze today's plan so drift has something to drift from.
 *
 * Three things about this are deliberate:
 *
 *   1. **The whole project at once.** A baseline captured task by task is not a
 *      baseline, it is a set of unrelated snapshots taken on different days,
 *      and the completion date derived from it would be fiction.
 *   2. **The COMPUTED dates are frozen, not the typed ones.** What is being
 *      recorded is "this is what the plan actually said", and the plan is what
 *      the scheduler produced from the durations and the links — a task with
 *      predecessors may have no typed dates at all.
 *   3. **Never overwritten.** A second capture makes "Baseline 2"; the first
 *      stays. Re-baselining after a major variation is a legitimate thing to
 *      do and destroying the original would remove the only record of what was
 *      originally agreed.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { name?: string };

  const bundle = await getScheduleBundle(params.id);
  if (!bundle) return error("Project not found", 404);
  if (bundle.tasks.length === 0)
    return error("There is nothing to baseline yet — add some tasks first", 422);

  const schedule = scheduleProject(bundle);
  if (schedule.cycle)
    return error(
      "The schedule contains a dependency loop — fix it before baselining",
      400,
      { cycle: schedule.cycle }
    );

  // Next free name. Counting existing DISTINCT names rather than rows, because
  // a baseline is one capture across many tasks.
  const { data: existing } = await auth.supabase
    .from("task_baselines")
    .select("baseline_name")
    .eq("project_id", params.id);
  const used = new Set(
    ((existing ?? []) as { baseline_name: string }[]).map((r) => r.baseline_name)
  );
  let name = String(body.name ?? "").trim();
  if (!name) {
    let n = used.size + 1;
    while (used.has(`Baseline ${n}`)) n += 1;
    name = `Baseline ${n}`;
  }
  if (used.has(name))
    return error(`"${name}" already exists — pick another name`, 409, {
      name: "Already used",
    });

  const taskById = new Map(bundle.tasks.map((t) => [t.id, t]));
  const rows = schedule.tasks.map((task) => {
    const stored = taskById.get(task.id) as Task;
    return {
      user_id: auth.user.id,
      project_id: params.id,
      task_id: task.id,
      baseline_name: name,
      planned_start: task.computed_start,
      planned_end: task.computed_end,
      duration_days: stored?.duration_days ?? null,
      budget_amount: stored?.budget_amount ?? null,
      captured_by: auth.user.id,
    };
  });

  const { data, error: dbError } = await auth.supabase
    .from("task_baselines")
    .insert(rows)
    .select();
  if (dbError?.code === "42P01")
    return error(
      "The schedule tables are not installed — run 0016_schedule_core.sql",
      503
    );
  // ux_task_baselines_task_name (0016) is on (task_id, baseline_name), and the
  // name above is worked out by READING the existing names — so two clicks a
  // moment apart both read the same set, both pick "Baseline 3", and the
  // second one loses. The database is doing exactly the right thing: every
  // task goes in one statement, so the loser rolls back whole and nothing
  // half-captured survives. Only the message was wrong — a raw Postgres
  // unique-violation string in a red toast, for a situation that is simply
  // "somebody already pressed this".
  if (dbError?.code === "23505")
    return error(
      `"${name}" was captured a moment ago — reload to see it`,
      409,
      { name: "Just captured" }
    );
  if (dbError) return error(dbError.message, 500);

  return json({ baseline_name: name, rows: data }, 201);
}
