import { requireUser, error } from "@/lib/api";
import { getProjectBundle } from "@/lib/data";
import { buildSummary } from "@/lib/summary";
import { SPENDABLE_ENTRY } from "@/lib/purchases";
import { buildSupplierRows, buildTradeRows } from "@/lib/invoiceViews";
import { ProjectReport } from "@/lib/pdf";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

export const runtime = "nodejs";

/**
 * The project as a PDF report.
 *
 * Same rule as the Excel route beside it: the tables come from the Analysis
 * tab's own builders and the cards from the Overview's, so the report reconciles
 * against the screens it was printed from. See the header of lib/pdf.tsx.
 *
 * Rollups only. The line-by-line Materials, Labour and Prices detail is in the
 * Excel export, which is the right format for it.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const bundle = await getProjectBundle(params.id);
  if (!bundle) return error("Project not found", 404);

  // Ledger rows excluded, as on every screen — see SPENDABLE_ENTRY.
  const entries = bundle.entries.filter(SPENDABLE_ENTRY);
  const supplierNames = new Map(Object.entries(bundle.supplierNames));

  const element = React.createElement(ProjectReport, {
    project: bundle.project,
    entries,
    summary: buildSummary(bundle.project, entries),
    trades: buildTradeRows(bundle.purchases, bundle.invoiceLines, supplierNames),
    suppliers: buildSupplierRows(
      bundle.purchases,
      bundle.invoiceLines,
      supplierNames
    ),
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
