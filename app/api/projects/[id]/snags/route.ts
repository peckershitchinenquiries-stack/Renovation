import { requireUser, json, error } from "@/lib/api";
import { validateSnag, hasErrors } from "@/lib/validation";
import { buildSnagPayload } from "@/lib/contactWrite";
import type { SnagInput } from "@/types";

/** Raise a snag (migration 0022). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as SnagInput;
  const errors = validateSnag(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  const { data, error: dbError } = await auth.supabase
    .from("snags")
    .insert({
      ...buildSnagPayload(body),
      project_id: params.id,
      user_id: auth.user.id,
    })
    .select()
    .single();

  if (dbError?.code === "42P01")
    return error(
      "The snagging tables are not installed — run 0022_activity_snags.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
