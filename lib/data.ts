// Server-side data loaders — fetch a project + its computed entries once and reuse.
import { createClient } from "@/lib/supabase/server";
import { computeEntries } from "@/lib/calculations";
import {
  ACTIVE_PURCHASE,
  buildItemTimeline,
  computePurchases,
  lastPurchaseDate,
  purchaseOrderKey,
  purchasesToSyntheticEntries,
  totalsBySource,
} from "@/lib/purchases";
import { buildInvoiceLines } from "@/lib/invoiceViews";
import type {
  Project,
  ProjectRef,
  ExpenseEntry,
  ExpenseEntryComputed,
  InvoiceLineView,
  TradeLookup,
  ProjectWeek,
  InvoiceRef,
  InvoiceUpload,
  Item,
  ItemAlias,
  ItemBundle,
  ItemListRow,
  ItemPriceRef,
  ItemRef,
  ItemSourceTotals,
  Payment,
  ProjectPurchaseList,
  ProjectPurchaseRow,
  Purchase,
  PurchaseComputed,
  PurchaseDetail,
  PurchaseEditBundle,
  PurchaseEntrySource,
  PurchaseFormBundle,
  PurchaseLine,
  PurchaseLineDetail,
  PurchaseTotals,
  Supplier,
  SupplierAlias,
  SupplierBundle,
  SupplierListRow,
  SupplierPurchaseGroup,
  SupplierRef,
} from "@/types";

export async function getProject(id: string): Promise<Project | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  return (data as Project) ?? null;
}

export interface ProjectBundle {
  project: Project;
  entries: ExpenseEntryComputed[];
  lookups: TradeLookup[];
  weeks: ProjectWeek[];
  invoiceTotals: PurchaseTotals[];
  // The transaction core for this project, flattened one line per row. This is
  // what the Trades / Labour / Materials / Suppliers / Price Tracker tabs are
  // built from — see lib/invoiceViews.ts for why they no longer read
  // expense_entries.
  invoiceLines: InvoiceLineView[];
  // Whole documents, for the screens that report paid / outstanding: payment is
  // recorded per invoice, never per line.
  purchases: PurchaseComputed[];
  supplierNames: Record<string, string>;
  // Purchase ids that still have the original photo or PDF behind them, i.e.
  // the ones committed from an upload (migration 0010). Only these can be
  // opened, so only these are linked — an invoice typed in by hand has no
  // document, and offering a link to one would be a promise the app cannot
  // keep. Ids only: a signed URL expires, so it is minted when clicked
  // (app/api/projects/[id]/purchases/[pid]/document).
  documentPurchaseIds: string[];
}

export async function getProjectBundle(id: string): Promise<ProjectBundle | null> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (!project) return null;

  // First pass: expense entries, lookups, weeks, and purchases for this project.
  const [
    { data: rawEntries },
    { data: lookups },
    { data: weeks },
    { data: rawPurchases },
  ] = await Promise.all([
    supabase
      .from("expense_entries")
      .select("*")
      .eq("project_id", id)
      .order("week_number", { ascending: true }),
    supabase.from("trade_lookups").select("*"),
    supabase.from("project_weeks").select("*").eq("project_id", id),
    // Cancelled purchases are fetched, not filtered in SQL: the Expenses list
    // shows them so they can be un-cancelled, and every figure derived below
    // applies ACTIVE_PURCHASE for itself.
    supabase.from("purchases").select("*").eq("project_id", id),
  ]);

  // Second pass: payments and lines scoped to this project's purchase IDs
  // only. selectIn handles the empty-array case without a wasted round trip.
  const purchaseIds = ((rawPurchases ?? []) as Purchase[]).map((p) => p.id);
  const [projectPayments, purchaseLines, committedUploads] = await Promise.all([
    selectIn<Payment>(supabase, "payments", "purchase_id", purchaseIds),
    selectIn<PurchaseLine>(supabase, "purchase_lines", "purchase_id", purchaseIds),
    // Which of these invoices still have their original file. Scoped by
    // invoice_id rather than project_id so an upload can only ever mark a
    // purchase this project actually owns.
    selectIn<InvoiceUpload>(supabase, "invoice_uploads", "invoice_id", purchaseIds),
  ]);

  const computedPurchases = computePurchases(
    (rawPurchases ?? []) as Purchase[],
    projectPayments
  );

  // Resolve supplier names for purchases so the synthetic entries carry a
  // readable supplier label (e.g. "Invoice 1234 – Lawsons").
  const supplierIds = [
    ...new Set(
      ((rawPurchases ?? []) as Purchase[])
        .map((p) => p.supplier_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  let supplierNames = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name")
      .in("id", supplierIds);
    supplierNames = new Map(
      ((suppliers ?? []) as { id: string; name: string }[]).map((s) => [
        s.id,
        s.name,
      ])
    );
  }

  // Build synthetic expense entries from invoice data and merge them in.
  // Invoice entries use source: "invoice" so they are distinguishable from
  // diary/ledger rows if needed (e.g. to render them read-only in the UI).
  const invoiceEntries = purchasesToSyntheticEntries(
    computedPurchases,
    supplierNames
  );

  const diaryEntries = computeEntries((rawEntries ?? []) as ExpenseEntry[]);

  // Item names, so a line matched to an item shows the canonical spelling and
  // its price history groups with every other spelling of the same thing.
  const items = await selectIn<Item>(
    supabase,
    "items",
    "id",
    distinct(purchaseLines.map((l) => l.item_id))
  );

  return {
    project: project as Project,
    // Merge invoice synthetic entries after diary/ledger rows so the existing
    // sort-by-week_number on diary entries is preserved at the front.
    entries: [...diaryEntries, ...invoiceEntries],
    lookups: (lookups ?? []) as TradeLookup[],
    weeks: (weeks ?? []) as ProjectWeek[],
    invoiceTotals: totalsBySource(computedPurchases.filter(ACTIVE_PURCHASE)),
    invoiceLines: buildInvoiceLines(
      computedPurchases,
      purchaseLines,
      supplierNames,
      new Map(items.map((i) => [i.id, i.canonical_name]))
    ),
    purchases: computedPurchases,
    supplierNames: Object.fromEntries(supplierNames),
    // Only a committed upload with a file behind it counts. Anything else —
    // pending, failed, abandoned — is not the document for this invoice.
    documentPurchaseIds: distinct(
      committedUploads
        .filter((u) => u.status === "committed" && Boolean(u.storage_path))
        .map((u) => u.invoice_id)
    ),
  };
}

// ============================================================
// Phase 1 — supplier and item loaders (the transaction core)
// ============================================================
// These read purchases / purchase_lines / payments / suppliers / items, added
// by migration 0008. Same rules as getProjectBundle above: a fixed handful of
// queries per page, never one per row, and never a .eq("user_id", …) — RLS is
// what scopes the data (about.md §9).
//
// Two things hold everywhere below:
//   • Cancelled purchases are excluded, matching ACTIVE in lib/summary.ts.
//   • Diary and ledger money is kept apart and never added (about.md §5).
//
// These loaders are deliberately cross-project: a supplier and an item are
// above the project, which is the point of the new tables.

type ServerClient = ReturnType<typeof createClient>;

// .in() with an empty list is a wasted round trip that PostgREST answers with
// an empty set anyway — skip it.
async function selectIn<T>(
  supabase: ServerClient,
  table: string,
  column: string,
  ids: string[]
): Promise<T[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from(table).select("*").in(column, ids);
  return (data ?? []) as T[];
}

const distinct = (values: (string | null)[]): string[] => [
  ...new Set(values.filter((v): v is string => Boolean(v))),
];

function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const arr = map.get(k) ?? [];
    arr.push(row);
    map.set(k, arr);
  }
  return map;
}

/** Every supplier, with how much has been spent with each and what is owed. */
export async function getSuppliers(): Promise<SupplierListRow[]> {
  const supabase = createClient();
  const [{ data: suppliers }, { data: purchases }, { data: payments }] =
    await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      supabase
        .from("purchases")
        .select("*")
        .neq("entry_status", "Cancelled"),
      supabase.from("payments").select("*"),
    ]);

  const computed = computePurchases(
    (purchases ?? []) as Purchase[],
    (payments ?? []) as Payment[]
  );
  const bySupplier = indexBy(
    computed.filter((p) => p.supplier_id),
    (p) => p.supplier_id as string
  );

  return ((suppliers ?? []) as Supplier[])
    .map((supplier) => {
      const list = bySupplier.get(supplier.id) ?? [];
      return {
        supplier,
        purchase_count: list.length,
        totals: totalsBySource(list),
        last_purchase_date: lastPurchaseDate(list),
      };
    })
    // Only show suppliers that have at least one purchase (non-zero entries).
    .filter((row) => row.purchase_count > 0)
    // Busiest first. Sorted on the record COUNT, not on money — ranking by a
    // diary + ledger total would be ranking by the double-count (about.md §5).
    .sort(
      (a, b) =>
        b.purchase_count - a.purchase_count ||
        a.supplier.name.localeCompare(b.supplier.name)
    );
}

// Turn raw purchases into the display shape: lines and payments nested, names
// resolved, and a running total accumulated oldest → newest within each
// entry_source. Returned newest first, which is how a statement reads.
function buildPurchaseGroups(
  purchases: PurchaseComputed[],
  lines: PurchaseLine[],
  payments: Payment[],
  supplierNames: Map<string, string>,
  projectNames: Map<string, string>,
  itemNames: Map<string, string>
): SupplierPurchaseGroup[] {
  const linesByPurchase = indexBy(lines, (l) => l.purchase_id);
  const paymentsByPurchase = indexBy(payments, (p) => p.purchase_id);
  const order: PurchaseEntrySource[] = ["diary", "ledger"];

  return order
    .map((entry_source) => {
      const inSource = purchases
        .filter((p) => p.entry_source === entry_source)
        .sort((a, b) => purchaseOrderKey(a) - purchaseOrderKey(b));

      let running = 0;
      const detailed: PurchaseDetail[] = inSource.map((purchase) => {
        running += Number(purchase.gross_total);
        const rawLines = (linesByPurchase.get(purchase.id) ?? [])
          .slice()
          .sort((a, b) => a.line_no - b.line_no);
        return {
          ...purchase,
          lines: rawLines.map(
            (l): PurchaseLineDetail => ({
              ...l,
              item_name: l.item_id ? itemNames.get(l.item_id) ?? null : null,
            })
          ),
          payments: (paymentsByPurchase.get(purchase.id) ?? [])
            .slice()
            .sort((a, b) => (a.paid_on ?? "").localeCompare(b.paid_on ?? "")),
          project_name: projectNames.get(purchase.project_id) ?? null,
          supplier_name: purchase.supplier_id
            ? supplierNames.get(purchase.supplier_id) ?? null
            : null,
          running_total: running,
        };
      });

      return {
        entry_source,
        totals: totalsBySource(inSource)[0],
        purchases: detailed.reverse(),
      };
    })
    .filter((g) => g.purchases.length > 0);
}

/** One supplier's full statement: its purchases, their lines and payments. */
export async function getSupplierBundle(
  id: string
): Promise<SupplierBundle | null> {
  const supabase = createClient();
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .single();
  if (!supplier) return null;

  const [{ data: aliases }, { data: rawPurchases }, { data: projects }] =
    await Promise.all([
      supabase
        .from("supplier_aliases")
        .select("*")
        .eq("supplier_id", id)
        .order("alias"),
      supabase
        .from("purchases")
        .select("*")
        .eq("supplier_id", id)
        .neq("entry_status", "Cancelled"),
      supabase.from("projects").select("id, name"),
    ]);

  const purchases = (rawPurchases ?? []) as Purchase[];
  const purchaseIds = purchases.map((p) => p.id);
  const [lines, payments] = await Promise.all([
    selectIn<PurchaseLine>(supabase, "purchase_lines", "purchase_id", purchaseIds),
    selectIn<Payment>(supabase, "payments", "purchase_id", purchaseIds),
  ]);

  const items = await selectIn<Item>(
    supabase,
    "items",
    "id",
    distinct(lines.map((l) => l.item_id))
  );

  return {
    supplier: supplier as Supplier,
    aliases: (aliases ?? []) as SupplierAlias[],
    groups: buildPurchaseGroups(
      computePurchases(purchases, payments),
      lines,
      payments,
      new Map([[(supplier as Supplier).id, (supplier as Supplier).name]]),
      new Map(
        ((projects ?? []) as { id: string; name: string }[]).map((p) => [
          p.id,
          p.name,
        ])
      ),
      new Map(items.map((i) => [i.id, i.canonical_name]))
    ),
  };
}

/** Every item, with how often it was bought and what it costs now. */
export async function getItems(): Promise<ItemListRow[]> {
  const supabase = createClient();
  const [{ data: items }, { data: purchases }, { data: lines }] =
    await Promise.all([
      supabase.from("items").select("*").order("canonical_name"),
      supabase.from("purchases").select("*").neq("entry_status", "Cancelled"),
      supabase.from("purchase_lines").select("*"),
    ]);

  const purchaseById = new Map(
    ((purchases ?? []) as Purchase[]).map((p) => [p.id, p])
  );
  const linesByItem = indexBy(
    ((lines ?? []) as PurchaseLine[]).filter(
      (l) => l.item_id && purchaseById.has(l.purchase_id)
    ),
    (l) => l.item_id as string
  );
  const noNames = new Map<string, string>();

  return ((items ?? []) as Item[])
    // Labour is a service, not a thing with a price per unit to track, so it
    // is the only category kept out. This used to require category ===
    // "Materials", which silently hid every item an invoice created without a
    // category set — the page said "no items" while the lines existed.
    .filter((item) => item.category !== "Labour")
    .map((item) => {
      const itemLines = linesByItem.get(item.id) ?? [];
      const points = buildItemTimeline(
        itemLines,
        purchaseById,
        noNames,
        noNames
      );
      // The most recent point that actually carried a unit price. Legacy diary
      // rows have none at all (about.md §3.1), so plenty of items have no
      // price to show — that is honest, not a gap.
      const priced = points.filter((p) => p.unit_price > 0);
      const latest = priced[priced.length - 1] ?? null;

      return {
        item,
        line_count: itemLines.length,
        supplier_count: distinct(
          itemLines.map((l) => purchaseById.get(l.purchase_id)?.supplier_id ?? null)
        ).length,
        latest_unit_price: latest?.unit_price ?? null,
        latest_delta_pct: latest?.delta_pct ?? null,
        trend: latest?.move ?? "first",
        last_purchase_date: lastPurchaseDate(
          itemLines
            .map((l) => purchaseById.get(l.purchase_id))
            .filter((p): p is Purchase => p !== undefined)
        ),
      } satisfies ItemListRow;
    })
    // Only show items that have at least one purchase line (QTY > 0).
    .filter((row) => row.line_count > 0)
    .sort(
      (a, b) =>
        b.line_count - a.line_count ||
        a.item.canonical_name.localeCompare(b.item.canonical_name)
    );
}

// ============================================================
// Phase 2 — what the multi-line invoice form needs
// ============================================================

/**
 * Everything the invoice form needs in one pass: who you buy from, what you
 * have bought before and what it cost last time, so the price and duplicate
 * warnings can be computed as you type without a round trip per keystroke.
 */
/**
 * Everything the invoice form needs, optionally scoped to a project.
 *
 * `projectId` is null for the nav-bar flow, where the project is a field on
 * the form rather than part of the route (about.md §8.2). Almost nothing here
 * was ever project-scoped — suppliers, items, trades and price history are
 * deliberately cross-project — so the only thing null costs is `project`
 * itself and a definite `next_week`, which is why the week is now returned per
 * project instead.
 */
export async function getPurchaseFormBundle(
  projectId: string | null
): Promise<PurchaseFormBundle | null> {
  const supabase = createClient();
  const [
    { data: project },
    { data: projects },
    { data: suppliers },
    { data: supplierAliases },
    { data: items },
    { data: itemAliases },
    { data: trades },
    { data: purchases },
    { data: pricedLines },
    { data: units },
    { data: entryWeeks },
  ] = await Promise.all([
    projectId
      ? supabase.from("projects").select("*").eq("id", projectId).single()
      : Promise.resolve({ data: null }),
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("supplier_aliases").select("*"),
    supabase.from("items").select("*").order("canonical_name"),
    supabase.from("item_aliases").select("*"),
    supabase.from("trade_lookups").select("*").order("name"),
    supabase.from("purchases").select("*").neq("entry_status", "Cancelled"),
    // Only lines that recorded a price per unit can answer "what did it cost
    // last time" — the legacy diary rows have none at all (about.md §3.1).
    supabase.from("purchase_lines").select("*").gt("unit_price", 0),
    supabase.from("purchase_lines").select("unit").not("unit", "is", null),
    // Every project's weeks, not just one — the form can now switch project
    // and must be able to answer "next week" for whichever is picked.
    supabase.from("expense_entries").select("project_id, week_number"),
  ]);

  // A named project that doesn't exist (or isn't the caller's) is still a 404;
  // no project asked for is not.
  if (projectId && !project) return null;

  const supplierRows = (suppliers ?? []) as Supplier[];
  const supplierNames = new Map(supplierRows.map((s) => [s.id, s.name]));
  const purchaseById = new Map(
    ((purchases ?? []) as Purchase[]).map((p) => [p.id, p])
  );

  // The most recent priced appearance of each item, ordered the way every
  // other timeline in this app is (about.md §8.1) — purchase_date, falling
  // back to created_at for the rows that never had one.
  const latestByItem = new Map<string, { line: PurchaseLine; purchase: Purchase }>();
  for (const line of (pricedLines ?? []) as PurchaseLine[]) {
    const purchase = purchaseById.get(line.purchase_id);
    if (!line.item_id || !purchase) continue;
    const held = latestByItem.get(line.item_id);
    if (!held || purchaseOrderKey(purchase) >= purchaseOrderKey(held.purchase))
      latestByItem.set(line.item_id, { line, purchase });
  }

  const aliasesFor = <T extends { alias: string }>(
    rows: T[],
    match: (row: T) => string,
    id: string,
    own: string
  ) =>
    rows
      .filter((row) => match(row) === id && row.alias !== own)
      .map((row) => row.alias);

  const supplierRefs: SupplierRef[] = supplierRows.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    aliases: aliasesFor(
      (supplierAliases ?? []) as SupplierAlias[],
      (a) => a.supplier_id,
      supplier.id,
      supplier.name
    ),
  }));

  const itemRefs: ItemRef[] = ((items ?? []) as Item[]).map((item) => {
    const latest = latestByItem.get(item.id);
    const last_price: ItemPriceRef | null = latest
      ? {
          unit_price: Number(latest.line.unit_price),
          unit: latest.line.unit,
          date: latest.purchase.purchase_date,
          supplier_name: latest.purchase.supplier_id
            ? supplierNames.get(latest.purchase.supplier_id) ?? null
            : null,
          entry_source: latest.purchase.entry_source,
        }
      : null;
    return {
      id: item.id,
      canonical_name: item.canonical_name,
      category: item.category,
      default_unit: item.default_unit,
      aliases: aliasesFor(
        (itemAliases ?? []) as ItemAlias[],
        (a) => a.item_id,
        item.id,
        item.canonical_name
      ),
      last_price,
    };
  });

  // Same supplier, same invoice number is the same document, whichever project
  // it was filed against — so this deliberately spans them all.
  const invoices: InvoiceRef[] = ((purchases ?? []) as Purchase[])
    .filter((p) => p.invoice_no)
    .map((p) => ({
      purchase_id: p.id,
      project_id: p.project_id,
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_id ? supplierNames.get(p.supplier_id) ?? null : null,
      invoice_no: p.invoice_no as string,
      purchase_date: p.purchase_date,
      gross: Number(p.gross_total),
    }));

  // Highest week seen per project, from both records — the week-by-week diary
  // and the invoices already filed. One more than that is where the next
  // document goes.
  const highestWeek = new Map<string, number>();
  const noteWeek = (id: string | null, week: number | null | undefined) => {
    if (!id || !week) return;
    highestWeek.set(id, Math.max(highestWeek.get(id) ?? 0, week));
  };
  for (const w of (entryWeeks ?? []) as {
    project_id: string;
    week_number: number;
  }[])
    noteWeek(w.project_id, w.week_number);
  for (const p of (purchases ?? []) as Purchase[]) noteWeek(p.project_id, p.week_no);

  const projectRefs = (projects ?? []) as ProjectRef[];
  const nextWeekByProject: Record<string, number> = {};
  for (const p of projectRefs)
    nextWeekByProject[p.id] = (highestWeek.get(p.id) ?? 0) + 1;

  return {
    project: (project as Project) ?? null,
    projects: projectRefs,
    suppliers: supplierRefs,
    items: itemRefs,
    trades: (trades ?? []) as TradeLookup[],
    units: distinct(((units ?? []) as { unit: string | null }[]).map((u) => u.unit)).sort(
      (a, b) => a.localeCompare(b)
    ),
    next_week: projectId ? nextWeekByProject[projectId] ?? 1 : 1,
    next_week_by_project: nextWeekByProject,
    invoices,
  };
}

/**
 * Every purchase filed against one project, newest first.
 *
 * Cancelled purchases are listed — you cannot un-cancel what you cannot see —
 * but they are excluded from the totals, exactly as ACTIVE does everywhere
 * else (about.md §6.2).
 */
export async function getProjectPurchases(
  projectId: string
): Promise<ProjectPurchaseList | null> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) return null;

  const { data: rawPurchases } = await supabase
    .from("purchases")
    .select("*")
    .eq("project_id", projectId);
  const purchases = (rawPurchases ?? []) as Purchase[];
  const purchaseIds = purchases.map((p) => p.id);

  const [lines, payments, suppliers] = await Promise.all([
    selectIn<PurchaseLine>(supabase, "purchase_lines", "purchase_id", purchaseIds),
    selectIn<Payment>(supabase, "payments", "purchase_id", purchaseIds),
    selectIn<Supplier>(
      supabase,
      "suppliers",
      "id",
      distinct(purchases.map((p) => p.supplier_id))
    ),
  ]);

  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
  const linesByPurchase = indexBy(lines, (l) => l.purchase_id);
  const paymentsByPurchase = indexBy(payments, (p) => p.purchase_id);

  const rows: ProjectPurchaseRow[] = computePurchases(purchases, payments)
    .map((purchase) => {
      const own = (linesByPurchase.get(purchase.id) ?? [])
        .slice()
        .sort((a, b) => a.line_no - b.line_no);
      return {
        ...purchase,
        supplier_name: purchase.supplier_id
          ? supplierNames.get(purchase.supplier_id) ?? null
          : null,
        line_count: own.length,
        payment_count: (paymentsByPurchase.get(purchase.id) ?? []).length,
        first_description: own[0]?.description_raw ?? null,
      };
    })
    .sort((a, b) => purchaseOrderKey(b) - purchaseOrderKey(a));

  return {
    project: project as Project,
    rows,
    totals: totalsBySource(rows.filter(ACTIVE_PURCHASE)),
  };
}

/** One purchase, loaded back into the form for editing. */
export async function getPurchaseEditBundle(
  projectId: string,
  purchaseId: string
): Promise<PurchaseEditBundle | null> {
  const supabase = createClient();
  const { data: purchase } = await supabase
    .from("purchases")
    .select("*")
    .eq("id", purchaseId)
    .eq("project_id", projectId)
    .single();
  if (!purchase) return null;

  const [{ data: lines }, { data: payments }] = await Promise.all([
    supabase
      .from("purchase_lines")
      .select("*")
      .eq("purchase_id", purchaseId)
      .order("line_no"),
    supabase
      .from("payments")
      .select("*")
      .eq("purchase_id", purchaseId)
      .order("paid_on", { nullsFirst: false }),
  ]);

  // The form edits the supplier as text, so it needs the name, not the id.
  let supplier_name: string | null = null;
  const supplierId = (purchase as Purchase).supplier_id;
  if (supplierId) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("name")
      .eq("id", supplierId)
      .single();
    supplier_name = (supplier as { name: string } | null)?.name ?? null;
  }

  return {
    purchase: purchase as Purchase,
    lines: (lines ?? []) as PurchaseLine[],
    payments: (payments ?? []) as Payment[],
    supplier_name,
  };
}

/** One item's price timeline across every supplier and every project. */
export async function getItemBundle(id: string): Promise<ItemBundle | null> {
  const supabase = createClient();
  const { data: item } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();
  if (!item) return null;

  const [{ data: aliases }, { data: rawLines }, { data: projects }] =
    await Promise.all([
      supabase.from("item_aliases").select("*").eq("item_id", id).order("alias"),
      supabase.from("purchase_lines").select("*").eq("item_id", id),
      supabase.from("projects").select("id, name"),
    ]);

  const lines = (rawLines ?? []) as PurchaseLine[];
  const purchases = (
    await selectIn<Purchase>(
      supabase,
      "purchases",
      "id",
      distinct(lines.map((l) => l.purchase_id))
    )
  ).filter((p) => p.entry_status !== "Cancelled");

  const suppliers = await selectIn<Supplier>(
    supabase,
    "suppliers",
    "id",
    distinct(purchases.map((p) => p.supplier_id))
  );

  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const points = buildItemTimeline(
    lines,
    purchaseById,
    new Map(suppliers.map((s) => [s.id, s.name])),
    new Map(
      ((projects ?? []) as { id: string; name: string }[]).map((p) => [
        p.id,
        p.name,
      ])
    )
  );

  // Quantity and spend, split by source — adding the two would double-count.
  const totalsMap = new Map<PurchaseEntrySource, ItemSourceTotals>();
  for (const p of points) {
    const row = totalsMap.get(p.entry_source) ?? {
      entry_source: p.entry_source,
      line_count: 0,
      qty: 0,
      net: 0,
    };
    row.line_count += 1;
    row.qty += p.qty;
    row.net += p.line_net;
    totalsMap.set(p.entry_source, row);
  }
  const order: PurchaseEntrySource[] = ["diary", "ledger"];

  return {
    item: item as Item,
    aliases: (aliases ?? []) as ItemAlias[],
    points,
    totals: order.filter((s) => totalsMap.has(s)).map((s) => totalsMap.get(s)!),
  };
}
