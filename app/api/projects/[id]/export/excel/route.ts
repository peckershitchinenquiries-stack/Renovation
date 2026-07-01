import { requireUser, error } from "@/lib/api";
import { getProjectBundle } from "@/lib/data";
import {
  buildSummary,
  buildTrades,
  buildMaterials,
  buildPriceHistory,
} from "@/lib/summary";
import { buildWorkbook } from "@/lib/export";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const bundle = await getProjectBundle(params.id);
  if (!bundle) return error("Project not found", 404);

  const summary = buildSummary(bundle.project, bundle.entries);
  const trades = buildTrades(bundle.entries);
  const materials = buildMaterials(bundle.entries);
  const prices = buildPriceHistory(bundle.entries);
  const buffer = buildWorkbook(
    bundle.project,
    bundle.entries,
    summary,
    trades,
    materials,
    prices
  );

  const filename = `${bundle.project.name.replace(/[^a-z0-9]+/gi, "_")}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
