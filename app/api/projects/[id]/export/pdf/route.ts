import { requireUser, error } from "@/lib/api";
import { getProjectBundle } from "@/lib/data";
import { buildSummary, buildTrades, buildMaterials } from "@/lib/summary";
import { ProjectReport } from "@/lib/pdf";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

export const runtime = "nodejs";

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

  const element = React.createElement(ProjectReport, {
    project: bundle.project,
    entries: bundle.entries,
    summary,
    trades,
    materials,
  }) as unknown as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);

  const filename = `${bundle.project.name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
