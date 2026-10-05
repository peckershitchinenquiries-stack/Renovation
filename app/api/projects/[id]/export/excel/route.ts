import { requireUser, error } from "@/lib/api";
import { getProjectBundle } from "@/lib/data";
import { buildSummary } from "@/lib/summary";
import { SPENDABLE_ENTRY } from "@/lib/purchases";
import {
  buildItemPriceRows,
  buildSupplierRows,
  buildTradeRows,
  labourLines,
  materialLines,
} from "@/lib/invoiceViews";
import { buildWorkbook } from "@/lib/export";

/**
 * The project as an .xlsx file.
 *
 * Every sheet is built by the same function that builds the screen it is named
 * after — `buildTradeRows`, `buildSupplierRows`, `materialLines`, `labourLines`
 * and `buildItemPriceRows` are exactly what the Analysis tab renders, and
 * `buildSummary` is what the Overview cards render. This route used to call a
 * second set of builders in lib/summary.ts whose assumptions predated invoices;
 * see the header of lib/export.ts for what that produced and why it mattered.
 *
 * Nothing is aggregated here. A route handler that did its own arithmetic would
 * be a third set of figures to keep in step.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const bundle = await getProjectBundle(params.id);
  if (!bundle) return error("Project not found", 404);

  // The same rule every screen applies — see SPENDABLE_ENTRY. Ledger rows are
  // reference data from a different job and are never added to this project's
  // money (about.md §5). This route used to pass the unfiltered set, which no
  // figure on screen does.
  const entries = bundle.entries.filter(SPENDABLE_ENTRY);
  const supplierNames = new Map(Object.entries(bundle.supplierNames));

  const buffer = buildWorkbook({
    project: bundle.project,
    entries,
    summary: buildSummary(bundle.project, entries),
    trades: buildTradeRows(bundle.purchases, bundle.invoiceLines, supplierNames),
    suppliers: buildSupplierRows(
      bundle.purchases,
      bundle.invoiceLines,
      supplierNames
    ),
    materials: materialLines(bundle.invoiceLines),
    labour: labourLines(bundle.invoiceLines),
    prices: buildItemPriceRows(bundle.invoiceLines),
  });

  const filename = `${bundle.project.name.replace(/[^a-z0-9]+/gi, "_")}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
