import { requireUser, json, error } from "@/lib/api";
import { validateDependency, hasErrors } from "@/lib/validation";
import { detectCycle } from "@/lib/schedule";
import type { DependencyInput, Task, TaskDependency } from "@/types";

/**
 * Link two tasks.
 *
 * The cycle check is the reason this route is not three lines. Postgres cannot
 * express "this graph stays acyclic" as a constraint, so the database will
 * happily accept A → B → C → A and the scheduler would then have no defined
 * answer for any date in the loop. `detectCycle` runs here, against the graph
 * that WOULD exist, and refuses with a 400 naming the tasks involved so the
 * user is told which link to break rather than that "something went wrong".
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as DependencyInput;
  const errors = validateDependency(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const [{ data: tasks }, { data: existing }] = await Promise.all([
    auth.supabase.from("tasks").select("*").eq("project_id", params.id),
    auth.supabase
      .from("task_dependencies")
      .select("*")
      .eq("project_id", params.id),
  ]);

  const taskList = (tasks ?? []) as Task[];
  const byId = new Map(taskList.map((t) => [t.id, t]));
  // Both ends must be tasks on THIS project. RLS shares everything, so without
  // this a link could be made across two projects and the scheduler would try
  // to date one project from another's calendar.
  if (!byId.has(body.predecessor_id) || !byId.has(body.successor_id))
    return error("Both tasks must be on this project", 422, {
      successor_id: "Pick a task on this project",
    });

  const proposed: TaskDependency = {
    id: "proposed",
    user_id: auth.user.id,
    project_id: params.id,
    predecessor_id: body.predecessor_id,
    successor_id: body.successor_id,
    dep_type: body.dep_type,
    lag_days: Math.round(Number(body.lag_days ?? 0)) || 0,
    // Migration 0020: the successor waits for a signature, not just a finish
    // date. It changes nothing about the cycle check below — it constrains
    // when work may START, never the shape of the graph.
    requires_signoff: Boolean(body.requires_signoff),
    created_at: new Date().toISOString(),
  };

  const cycle = detectCycle(taskList, [
    ...((existing ?? []) as TaskDependency[]),
    proposed,
  ]);
  if (cycle) {
    const names = cycle.map((id) => byId.get(id)?.name ?? "?").join(" → ");
    return error(`That link would create a loop: ${names}`, 400, {
      successor_id: "This would depend on itself, through other tasks",
      cycle: names,
    });
  }

  const { data, error: dbError } = await auth.supabase
    .from("task_dependencies")
    .insert({
      user_id: auth.user.id,
      project_id: params.id,
      predecessor_id: proposed.predecessor_id,
      successor_id: proposed.successor_id,
      dep_type: proposed.dep_type,
      lag_days: proposed.lag_days,
      requires_signoff: proposed.requires_signoff,
    })
    .select()
    .single();

  // ux_task_dependencies_pair: one link per pair. Saying so beats a 500.
  if (dbError?.code === "23505")
    return error("Those two tasks are already linked", 409, {
      successor_id: "Already linked to this task",
    });
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
