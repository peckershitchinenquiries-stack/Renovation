import { requireUser, json, error } from "@/lib/api";
import { getProjectBundle } from "@/lib/data";
import { buildByCategory } from "@/lib/summary";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const bundle = await getProjectBundle(params.id);
  if (!bundle) return error("Project not found", 404);
  return json(buildByCategory(bundle.entries));
}
