// Server-side data loaders — fetch a project + its computed entries once and reuse.
import { createClient } from "@/lib/supabase/server";
import { computeEntries } from "@/lib/calculations";
import {
  ACTIVE_PURCHASE,
  buildItemTimeline,
  computePurchases,
  lastPurchaseDate,
  normaliseName,
  purchaseOrderKey,
  purchasesToSyntheticEntries,
  retentionIsDue,
  totalsBySource,
} from "@/lib/purchases";
import { buildInvoiceLines } from "@/lib/invoiceViews";
import { projectHealth } from "@/lib/portfolio";
// ---- Track B (migrations 0019–0024) ----
import {
  certificationViews,
  expiryStatus,
  todayISO,
  worstState,
} from "@/lib/certifications";
import { documentViews } from "@/lib/documents";
import { computeOrder } from "@/lib/purchaseOrders";
import { variationRollup, variationViews } from "@/lib/variations";
import { scheduleProject } from "@/lib/schedule";
import { taskCostRows } from "@/lib/scheduleCosts";
import type {
  ActivityEntry,
  CertificationView,
  CommunicationBundle,
  Contact,
  ContactBundle,
  ContactCertification,
  ContactListRow,
  DocumentBundle,
  ProjectDocument,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderRef,
  PurchaseOrderView,
  Snag,
  TaskSignoff,
  Variation,
  VariationRollup,
  VariationView,
} from "@/types";
import type {
  ProjectHealth,
  ProjectHoliday,
  ProjectPhase,
  ScheduleBundle,
  Task,
  TaskBaseline,
  TaskDependency,
  TaskRef,
  TaskRevision,
  TaskStatus,
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
  // what the Analysis tab's four pivots are built from — see lib/invoiceViews.ts
  // for why they no longer read expense_entries.
  invoiceLines: InvoiceLineView[];
  // Whole documents, for the screens that report paid / outstanding: payment is
  // recorded per invoice, never per line.
  purchases: PurchaseComputed[];
  supplierNames: Record<string, string>;
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
  const [projectPayments, purchaseLines] = await Promise.all([
    selectIn<Payment>(supabase, "payments", "purchase_id", purchaseIds),
    selectIn<PurchaseLine>(supabase, "purchase_lines", "purchase_id", purchaseIds),
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

  // Tasks for the line-level task picker (migration 0017). Read separately and
  // tolerantly: on a database where 0016 has not been pasted in yet this is a
  // missing relation, and an invoice form that 500s because the SCHEDULE is
  // not installed would be an absurd coupling. The picker simply does not
  // appear until the tables exist.
  const { data: taskRows } = await supabase
    .from("tasks")
    .select("id, name, status, project_id, phase_id, sort_order")
    .order("sort_order");
  const { data: phaseRows } = await supabase
    .from("project_phases")
    .select("id, name");

  // Open purchase orders, for the "which order is this?" picker (0023). Read
  // just as tolerantly as the tasks above: a database without 0023 gets no
  // picker rather than a 500 on the invoice form.
  const { data: orderRows } = await supabase
    .from("purchase_orders")
    .select("id, po_number, supplier_id, raised_on, status, project_id")
    .order("raised_on", { ascending: false });

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

  const phaseNames = new Map(
    ((phaseRows ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );
  const tasksByProject: Record<string, TaskRef[]> = {};
  for (const row of (taskRows ?? []) as {
    id: string;
    name: string;
    status: TaskStatus;
    project_id: string;
    phase_id: string | null;
  }[]) {
    // Cancelled work is not something a new invoice should be filed against.
    if (row.status === "Cancelled") continue;
    (tasksByProject[row.project_id] ||= []).push({
      id: row.id,
      name: row.name,
      phase_name: row.phase_id ? phaseNames.get(row.phase_id) ?? null : null,
      status: row.status,
    });
  }

  // Draft and cancelled orders are left out: an invoice cannot answer an order
  // that was never sent or that was called off, and offering them would let a
  // price variance be computed against a document nobody acted on.
  const ordersByProject: Record<string, PurchaseOrderRef[]> = {};
  for (const row of (orderRows ?? []) as (PurchaseOrderRef & {
    project_id: string;
  })[]) {
    if (row.status === "draft" || row.status === "cancelled") continue;
    (ordersByProject[row.project_id] ||= []).push({
      id: row.id,
      po_number: row.po_number,
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_id
        ? supplierNames.get(row.supplier_id) ?? null
        : null,
      raised_on: row.raised_on,
      status: row.status,
    });
  }

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
    tasks_by_project: tasksByProject,
    orders_by_project: ordersByProject,
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

  const [lines, payments, suppliers, uploads] = await Promise.all([
    selectIn<PurchaseLine>(supabase, "purchase_lines", "purchase_id", purchaseIds),
    selectIn<Payment>(supabase, "payments", "purchase_id", purchaseIds),
    selectIn<Supplier>(
      supabase,
      "suppliers",
      "id",
      distinct(purchases.map((p) => p.supplier_id))
    ),
    // Which of these invoices still have their original document, so the
    // invoice number can be linked to it. Same rule as the document route
    // itself: committed, and with a file actually stored.
    selectIn<InvoiceUpload>(supabase, "invoice_uploads", "invoice_id", purchaseIds),
  ]);

  const withDocument = new Set(
    uploads
      .filter((u) => u.status === "committed" && Boolean(u.storage_path))
      .map((u) => u.invoice_id)
  );

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
        has_document: withDocument.has(purchase.id),
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

// ============================================================
// The schedule (migrations 0016–0018)
// ============================================================
// Same rules as everything above: a fixed handful of queries per page, never
// one per row, and never a .eq("user_id", …) — RLS scopes the data.

/**
 * Everything the Schedule tab and the Gantt read, in one pass.
 *
 * Deliberately does NOT fetch invoice lines or purchases. The project page has
 * already loaded those for the Costs and Analysis tabs, and per-task cost is
 * derived from them in the browser by lib/scheduleCosts.ts — fetching them a
 * second time here would be the same waste getProjectPurchases already pays
 * for the Invoices tab, without its justification.
 *
 * The baseline returned is the CURRENT one only: the most recently captured
 * `baseline_name`. Earlier baselines stay in the table (a re-baseline after a
 * major variation must not destroy what came before) but nothing reads them —
 * drift is always measured against the latest.
 */
export async function getScheduleBundle(
  projectId: string
): Promise<ScheduleBundle | null> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) return null;

  const [
    { data: phases },
    { data: tasks, error: tasksError },
    { data: dependencies },
    { data: baselines },
    { data: revisions },
    { data: holidays },
    { data: signoffs },
  ] = await Promise.all([
    supabase
      .from("project_phases")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order"),
    supabase.from("tasks").select("*").eq("project_id", projectId).order("sort_order"),
    supabase.from("task_dependencies").select("*").eq("project_id", projectId),
    supabase
      .from("task_baselines")
      .select("*")
      .eq("project_id", projectId)
      .order("captured_at", { ascending: false }),
    // The history panel shows the most recent changes, not all of them. A
    // year of a busy schedule is thousands of rows and nobody scrolls them.
    supabase
      .from("task_revisions")
      .select("*")
      .eq("project_id", projectId)
      .order("changed_at", { ascending: false })
      .limit(200),
    supabase
      .from("project_holidays")
      .select("*")
      .eq("project_id", projectId)
      .order("holiday_date"),
    // Sign-offs (migration 0020). The engine needs them to answer
    // `requires_signoff` links; the tab needs them to say who signed what.
    supabase
      .from("task_signoffs")
      .select("*")
      .eq("project_id", projectId)
      .order("signed_at", { ascending: false }),
  ]);

  // 0016 has not been pasted into the SQL editor yet.
  //
  // supabase-js reports this in the result rather than throwing, so the page's
  // `.catch()` never sees it and the tab used to render as a perfectly ordinary
  // EMPTY schedule — a project with no tasks and a missing database look
  // identical, which is about.md §2 rule 3 exactly. Returning null instead is
  // what makes ProjectDetail show "run 0016_schedule_core.sql".
  if (missingRelation(tasksError)) return null;

  const allBaselines = (baselines ?? []) as TaskBaseline[];
  // Newest first from the query, so the first row names the current set.
  const currentName = allBaselines[0]?.baseline_name ?? null;

  return {
    project: project as Project,
    phases: (phases ?? []) as ProjectPhase[],
    tasks: (tasks ?? []) as Task[],
    dependencies: (dependencies ?? []) as TaskDependency[],
    baseline: currentName
      ? allBaselines.filter((b) => b.baseline_name === currentName)
      : [],
    baseline_name: currentName,
    revisions: (revisions ?? []) as TaskRevision[],
    signoffs: (signoffs ?? []) as TaskSignoff[],
    calendar: {
      working_weekdays: ((project as Project).working_weekdays ?? [1, 2, 3, 4, 5]).map(
        Number
      ),
      holidays: ((holidays ?? []) as ProjectHoliday[]).map((h) => h.holiday_date),
    },
  };
}

export interface PortfolioData {
  healths: ProjectHealth[];
  // The same bundles the health figures were computed from, so the rolled-up
  // multi-project Gantt can be drawn without a second pass over the database.
  bundles: ScheduleBundle[];
}

/**
 * Every project's health, for the portfolio dashboard (Phase 8).
 *
 * Eight whole-table reads rather than a per-project loop. This is a
 * single-workspace app tracking one renovation and possibly a second — tens of
 * tasks, not thousands — so the cost of reading everything once and grouping in
 * memory is lower than the cost of N round trips, and very much simpler than a
 * view. Do not build this for a scale that will not arrive.
 */
export async function getPortfolio(): Promise<PortfolioData> {
  const supabase = createClient();
  const [
    { data: projects },
    { data: phases },
    { data: tasks },
    { data: dependencies },
    { data: baselines },
    { data: holidays },
    { data: signoffs },
    { data: rawPurchases },
    { data: rawPayments },
    { data: rawLines },
    { data: rawEntries },
    { data: suppliers },
    { data: items },
  ] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("project_phases").select("*"),
    supabase.from("tasks").select("*"),
    supabase.from("task_dependencies").select("*"),
    supabase.from("task_baselines").select("*").order("captured_at", { ascending: false }),
    supabase.from("project_holidays").select("*"),
    supabase.from("task_signoffs").select("*"),
    supabase.from("purchases").select("*"),
    supabase.from("payments").select("*"),
    supabase.from("purchase_lines").select("*"),
    supabase.from("expense_entries").select("*"),
    supabase.from("suppliers").select("id, name"),
    supabase.from("items").select("id, canonical_name"),
  ]);

  const supplierNames = new Map(
    ((suppliers ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name])
  );
  const itemNames = new Map(
    ((items ?? []) as { id: string; canonical_name: string }[]).map((i) => [
      i.id,
      i.canonical_name,
    ])
  );

  const computedPurchases = computePurchases(
    (rawPurchases ?? []) as Purchase[],
    (rawPayments ?? []) as Payment[]
  );
  const allLines = buildInvoiceLines(
    computedPurchases,
    (rawLines ?? []) as PurchaseLine[],
    supplierNames,
    itemNames
  );
  // 'ledger' rows overlap the diary and summing both double-counts (about.md
  // §5) — the same filter the dashboard and ProjectDetail already apply.
  const allEntries = computeEntries((rawEntries ?? []) as ExpenseEntry[]).filter(
    (e) => e.source !== "ledger"
  );

  const group = <T extends { project_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.project_id) ?? [];
      list.push(row);
      map.set(row.project_id, list);
    }
    return map;
  };

  const phasesBy = group((phases ?? []) as ProjectPhase[]);
  const tasksBy = group((tasks ?? []) as Task[]);
  const depsBy = group((dependencies ?? []) as TaskDependency[]);
  const baselinesBy = group((baselines ?? []) as TaskBaseline[]);
  const holidaysBy = group((holidays ?? []) as ProjectHoliday[]);
  const signoffsBy = group((signoffs ?? []) as TaskSignoff[]);
  const linesBy = group(allLines);
  const entriesBy = group(allEntries);
  const purchasesBy = group(computedPurchases);

  const bundles: ScheduleBundle[] = [];
  const healths = ((projects ?? []) as Project[]).map((project) => {
    const projectBaselines = baselinesBy.get(project.id) ?? [];
    const currentName = projectBaselines[0]?.baseline_name ?? null;
    const bundle: ScheduleBundle = {
      project,
      phases: phasesBy.get(project.id) ?? [],
      tasks: tasksBy.get(project.id) ?? [],
      dependencies: depsBy.get(project.id) ?? [],
      baseline: currentName
        ? projectBaselines.filter((b) => b.baseline_name === currentName)
        : [],
      baseline_name: currentName,
      revisions: [],
      signoffs: signoffsBy.get(project.id) ?? [],
      calendar: {
        working_weekdays: (project.working_weekdays ?? [1, 2, 3, 4, 5]).map(Number),
        holidays: (holidaysBy.get(project.id) ?? []).map((h) => h.holiday_date),
      },
    };
    bundles.push(bundle);
    return projectHealth({
      bundle,
      lines: linesBy.get(project.id) ?? [],
      purchases: purchasesBy.get(project.id) ?? [],
      entries: entriesBy.get(project.id) ?? [],
    });
  });

  return { healths, bundles };
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

// ============================================================
// Track B — people, documents, communication, orders, variations
// (migrations 0019–0024)
// ============================================================
// Same rules as everything above: a fixed handful of queries per page, never
// one per row, and never a .eq("user_id", …) — RLS scopes the data.
//
// Every loader here TOLERATES its tables not existing. Migrations in this
// project are pasted into the SQL editor by hand (CLAUDE.md), so on a database
// where 0020 has not been run `contacts` is a missing relation rather than an
// empty table. These treat that as "not installed yet" and return null, so the
// screen can say so — instead of the whole page 500ing, and instead of an
// empty list that is indistinguishable from "nobody has been added". That
// ambiguity is exactly what about.md §2 rule 3 warns about, and it has caused
// a real incident here before.

/**
 * Is this string a UUID?
 *
 * Used to guard the ONE place in this codebase that builds a PostgREST filter
 * by string interpolation — `getDocumentBundle`'s `.or(...)`. Every other
 * query passes values through `.eq()` and friends, which send them as
 * parameters that cannot be read as syntax. An `.or()` takes a filter
 * EXPRESSION, so an id containing a comma or a dot would be parsed as more
 * filter rather than as a value.
 *
 * Route params reach these loaders straight from the URL, so nothing upstream
 * guarantees the shape. Checking it here is cheap and removes the question.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Did that query fail because the table is not there yet? */
function missingRelation(
  err: { code?: string; message?: string } | null
): boolean {
  if (!err) return false;
  // 42P01 undefined_table; PostgREST answers PGRST205 for a relation missing
  // from its schema cache, which is what a freshly-created table looks like
  // until the cache reloads.
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /does not exist|schema cache/i.test(err.message ?? "")
  );
}

/** Every person in the register, with the state of their certificates. */
export async function getContacts(): Promise<ContactListRow[] | null> {
  const supabase = createClient();
  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("*")
    .order("name");
  if (missingRelation(contactsError)) return null;

  const rows = (contacts ?? []) as Contact[];
  const [{ data: certs }, { data: tasks }] = await Promise.all([
    supabase.from("contact_certifications").select("*"),
    supabase.from("tasks").select("id, assignee_contact_id, status"),
  ]);

  const certsBy = indexBy(
    (certs ?? []) as ContactCertification[],
    (c) => c.contact_id
  );
  const taskCount = new Map<string, number>();
  for (const t of (tasks ?? []) as {
    assignee_contact_id: string | null;
    status: TaskStatus;
  }[]) {
    if (!t.assignee_contact_id || t.status === "Cancelled") continue;
    taskCount.set(
      t.assignee_contact_id,
      (taskCount.get(t.assignee_contact_id) ?? 0) + 1
    );
  }

  const today = todayISO();
  return rows
    .map((contact): ContactListRow => {
      const own = certsBy.get(contact.id) ?? [];
      const states = own.map((c) => expiryStatus(c.expires_on, today).state);
      return {
        contact,
        task_count: taskCount.get(contact.id) ?? 0,
        // No certificates on file is 'unknown', never 'valid'. "We have not
        // checked" and "we checked and it is fine" are different answers, and
        // a register that conflates them is worse than no register.
        worst_state: states.length === 0 ? "unknown" : worstState(states),
        expiring_count: states.filter((s) => s === "expiring_soon").length,
        expired_count: states.filter((s) => s === "expired").length,
      };
    })
    .sort(
      // Inactive people last; otherwise alphabetical. Deliberately NOT sorted
      // by expiry — a directory that reorders itself as certificates age
      // cannot be navigated from memory.
      (a, b) =>
        Number(a.contact.status === "inactive") -
          Number(b.contact.status === "inactive") ||
        a.contact.name.localeCompare(b.contact.name)
    );
}

/** One person: details, certificates, assigned work and labour paid. */
export async function getContactBundle(
  id: string
): Promise<ContactBundle | null> {
  const supabase = createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .single();
  if (!contact) return null;
  const person = contact as Contact;

  const [{ data: certs }, { data: tasks }, { data: projects }, { data: allLines }] =
    await Promise.all([
      supabase.from("contact_certifications").select("*").eq("contact_id", id),
      supabase.from("tasks").select("*").eq("assignee_contact_id", id),
      supabase.from("projects").select("id, name"),
      supabase
        .from("purchase_lines")
        .select("line_net, description_raw, purchase_id"),
    ]);

  let supplier_name: string | null = null;
  if (person.supplier_id) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("name")
      .eq("id", person.supplier_id)
      .single();
    supplier_name = (supplier as { name: string } | null)?.name ?? null;
  }

  // Labour paid to this person, matched on the NAME written on the invoice
  // line. That is how labour has always been recorded — the person's name goes
  // on `purchase_lines.description_raw` and no supplier row is created
  // (about.md §6.6.1) — and nothing retro-tags the history when a contact is
  // added. So this is a text match, it is approximate, and the screen says so
  // rather than presenting it as an authoritative total.
  const key = normaliseName(person.name);
  const matching = key
    ? ((allLines ?? []) as {
        line_net: number;
        description_raw: string;
        purchase_id: string;
      }[]).filter((l) => normaliseName(l.description_raw).includes(key))
    : [];

  const labourPurchases = await selectIn<Purchase>(
    supabase,
    "purchases",
    "id",
    distinct(matching.map((l) => l.purchase_id))
  );
  const activeIds = new Set(
    labourPurchases.filter(ACTIVE_PURCHASE).map((p) => p.id)
  );
  const counted = matching.filter((l) => activeIds.has(l.purchase_id));

  const projectNames = new Map(
    ((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );

  return {
    contact: person,
    certifications: certificationViews(
      (certs ?? []) as ContactCertification[],
      new Map([[person.id, person.name]])
    ),
    supplier_name,
    tasks: ((tasks ?? []) as Task[])
      .filter((t) => t.status !== "Cancelled")
      .map((task) => ({
        task,
        project_id: task.project_id,
        project_name: projectNames.get(task.project_id) ?? null,
      })),
    labour_net: counted.reduce((s, l) => s + Number(l.line_net), 0),
    labour_line_count: counted.length,
  };
}

/**
 * Certificates that have lapsed or are about to, for the Dashboard warning.
 *
 * This query is what makes the certification table worth having at all. A
 * compliance date buried on a detail page is a compliance date nobody reads.
 */
export async function getExpiringCertifications(): Promise<CertificationView[]> {
  const supabase = createClient();
  const { data: certs, error } = await supabase
    .from("contact_certifications")
    .select("*")
    .not("expires_on", "is", null);
  if (missingRelation(error)) return [];

  const rows = (certs ?? []) as ContactCertification[];
  if (rows.length === 0) return [];

  const contacts = await selectIn<Contact>(
    supabase,
    "contacts",
    "id",
    distinct(rows.map((c) => c.contact_id))
  );
  // Active people only. Chasing a lapsed certificate for somebody who left the
  // job is noise, and noise is what makes a warning ignorable.
  const active = new Map(
    contacts.filter((c) => c.status === "active").map((c) => [c.id, c.name])
  );

  return certificationViews(
    rows.filter((c) => active.has(c.contact_id)),
    active
  ).filter((v) => v.state === "expired" || v.state === "expiring_soon");
}

export interface RetentionDueRow {
  purchase: PurchaseComputed;
  project_name: string | null;
  supplier_name: string | null;
}

/**
 * Retentions past their release date and still held (migration 0019).
 *
 * A retention nobody reclaims is a discount you gave away without meaning to,
 * and nothing else in the app will ever remind you — it is deliberately kept
 * out of Owed, so it will never appear on a chase list.
 */
export async function getRetentionsDue(): Promise<RetentionDueRow[]> {
  const supabase = createClient();
  const { data: purchases, error } = await supabase
    .from("purchases")
    .select("*")
    .not("retention_pct", "is", null)
    .is("retention_released_on", null);
  // 0019 not run: the column does not exist, so there are no retentions.
  if (missingRelation(error)) return [];

  const rows = ((purchases ?? []) as Purchase[]).filter(ACTIVE_PURCHASE);
  if (rows.length === 0) return [];

  const [payments, suppliers, { data: projects }] = await Promise.all([
    selectIn<Payment>(
      supabase,
      "payments",
      "purchase_id",
      rows.map((p) => p.id)
    ),
    selectIn<Supplier>(
      supabase,
      "suppliers",
      "id",
      distinct(rows.map((p) => p.supplier_id))
    ),
    supabase.from("projects").select("id, name"),
  ]);

  const today = todayISO();
  const projectNames = new Map(
    ((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));

  return computePurchases(rows, payments)
    .filter((p) => retentionIsDue(p, today))
    .sort((a, b) =>
      (a.retention_release_due ?? "").localeCompare(
        b.retention_release_due ?? ""
      )
    )
    .map((purchase) => ({
      purchase,
      project_name: projectNames.get(purchase.project_id) ?? null,
      supplier_name: purchase.supplier_id
        ? supplierNames.get(purchase.supplier_id) ?? null
        : null,
    }));
}

/** Everything the Documents screen reads, in one pass (migration 0021). */
export async function getDocumentBundle(
  projectId: string
): Promise<DocumentBundle | null> {
  const supabase = createClient();
  // The id is interpolated into a filter expression below rather than passed
  // as a parameter, which is the only place in this file that happens. A
  // non-UUID cannot name a project anyway, so it is refused here instead of
  // being pasted into PostgREST syntax and finding out what it means.
  if (!isUuid(projectId)) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) return null;

  const { data: documents, error } = await supabase
    .from("documents")
    .select("*")
    // Project-less documents — a company insurance certificate, say — are
    // shown alongside this project's. They are genuinely relevant to every
    // job, and hiding one is how a certificate goes unnoticed.
    //
    // `.or()` takes a filter EXPRESSION, so this is string-built where every
    // other query in this file uses `.eq()`. The `isUuid` guard above is what
    // makes that safe; do not remove one without the other.
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .order("created_at", { ascending: false });
  if (missingRelation(error)) return null;

  const [{ data: phases }, { data: tasks }, { data: contacts }] =
    await Promise.all([
      supabase
        .from("project_phases")
        .select("id, name")
        .eq("project_id", projectId)
        .order("sort_order"),
      supabase
        .from("tasks")
        .select("id, name")
        .eq("project_id", projectId)
        .order("sort_order"),
      supabase.from("contacts").select("id, name").order("name"),
    ]);

  const phaseList = (phases ?? []) as { id: string; name: string }[];
  const taskList = (tasks ?? []) as { id: string; name: string }[];
  const contactList = (contacts ?? []) as { id: string; name: string }[];

  return {
    project: project as Project,
    documents: documentViews((documents ?? []) as ProjectDocument[], {
      phases: new Map(phaseList.map((p) => [p.id, p.name])),
      tasks: new Map(taskList.map((t) => [t.id, t.name])),
      contacts: new Map(contactList.map((c) => [c.id, c.name])),
    }),
    phases: phaseList,
    tasks: taskList,
    contacts: contactList,
  };
}

/** The activity log and the snagging list, in one pass (migration 0022). */
export async function getCommunicationBundle(
  projectId: string
): Promise<CommunicationBundle | null> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) return null;

  const [{ data: activity, error: activityError }, { data: snags }] =
    await Promise.all([
      supabase
        .from("activity_log")
        .select("*")
        .eq("project_id", projectId)
        .order("occurred_at", { ascending: false })
        // Read, not audited: a year of a busy job is thousands of rows and
        // nobody scrolls them. Same reasoning as the revision log's limit.
        .limit(300),
      supabase
        .from("snags")
        .select("*")
        .eq("project_id", projectId)
        .order("raised_on", { ascending: false }),
    ]);
  if (missingRelation(activityError)) return null;

  const snagRows = (snags ?? []) as Snag[];

  const [{ data: phases }, { data: tasks }, { data: contacts }, photos] =
    await Promise.all([
      supabase
        .from("project_phases")
        .select("id, name")
        .eq("project_id", projectId)
        .order("sort_order"),
      supabase
        .from("tasks")
        .select("id, name")
        .eq("project_id", projectId)
        .order("sort_order"),
      supabase.from("contacts").select("id, name").order("name"),
      // Snag photos are `documents` rows with a snag_id, not a second file
      // store (0022). One document table means one upload route, one bucket
      // and one delete path.
      selectIn<ProjectDocument>(
        supabase,
        "documents",
        "snag_id",
        snagRows.map((s) => s.id)
      ),
    ]);

  const phaseList = (phases ?? []) as { id: string; name: string }[];
  const taskList = (tasks ?? []) as { id: string; name: string }[];
  const contactList = (contacts ?? []) as { id: string; name: string }[];
  const phaseNames = new Map(phaseList.map((p) => [p.id, p.name]));
  const taskNames = new Map(taskList.map((t) => [t.id, t.name]));
  const contactNames = new Map(contactList.map((c) => [c.id, c.name]));
  const photosBySnag = indexBy(
    photos.filter((d) => d.snag_id),
    (d) => d.snag_id as string
  );

  const nameOf = (map: Map<string, string>, id: string | null) =>
    id ? map.get(id) ?? null : null;

  return {
    project: project as Project,
    activity: ((activity ?? []) as ActivityEntry[]).map((entry) => ({
      ...entry,
      contact_name: nameOf(contactNames, entry.contact_id),
      task_name: nameOf(taskNames, entry.task_id),
      phase_name: nameOf(phaseNames, entry.phase_id),
    })),
    snags: snagRows.map((snag) => ({
      ...snag,
      contact_name: nameOf(contactNames, snag.contact_id),
      task_name: nameOf(taskNames, snag.task_id),
      phase_name: nameOf(phaseNames, snag.phase_id),
      photos: photosBySnag.get(snag.id) ?? [],
    })),
    phases: phaseList,
    tasks: taskList,
    contacts: contactList,
  };
}

export interface PurchaseOrderList {
  project: Project;
  orders: PurchaseOrderView[];
  suppliers: SupplierRef[];
  tasks: { id: string; name: string }[];
}

/** Every order on one project, with its match back to invoices (0023). */
export async function getPurchaseOrders(
  projectId: string
): Promise<PurchaseOrderList | null> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) return null;

  const { data: orders, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("project_id", projectId)
    .order("raised_on", { ascending: false });
  if (missingRelation(error)) return null;

  const orderRows = (orders ?? []) as PurchaseOrder[];
  const orderIds = orderRows.map((o) => o.id);

  const [lines, { data: suppliers }, { data: tasks }, { data: matched }] =
    await Promise.all([
      selectIn<PurchaseOrderLine>(
        supabase,
        "purchase_order_lines",
        "po_id",
        orderIds
      ),
      supabase.from("suppliers").select("id, name").order("name"),
      supabase
        .from("tasks")
        .select("id, name")
        .eq("project_id", projectId)
        .order("sort_order"),
      // Invoices filed against these orders, cancelled ones excluded here
      // rather than downstream: a cancelled invoice is not evidence of a price
      // and must never enter the variance.
      orderIds.length === 0
        ? Promise.resolve({ data: [] as Purchase[] })
        : supabase
            .from("purchases")
            .select("*")
            .in("purchase_order_id", orderIds)
            .neq("entry_status", "Cancelled"),
    ]);

  const supplierList = (suppliers ?? []) as { id: string; name: string }[];
  const taskList = (tasks ?? []) as { id: string; name: string }[];
  const linesByOrder = indexBy(lines, (l) => l.po_id);
  const invoicesByOrder = indexBy(
    ((matched ?? []) as Purchase[]).filter((p) => p.purchase_order_id),
    (p) => p.purchase_order_id as string
  );
  const names = {
    suppliers: new Map(supplierList.map((s) => [s.id, s.name])),
    tasks: new Map(taskList.map((t) => [t.id, t.name])),
  };

  return {
    project: project as Project,
    orders: orderRows.map((order) =>
      computeOrder(
        order,
        linesByOrder.get(order.id) ?? [],
        invoicesByOrder.get(order.id) ?? [],
        names
      )
    ),
    suppliers: supplierList.map((s) => ({ id: s.id, name: s.name, aliases: [] })),
    tasks: taskList,
  };
}

export interface VariationList {
  project: Project;
  variations: VariationView[];
  rollup: VariationRollup;
  phases: { id: string; name: string }[];
  tasks: { id: string; name: string }[];
}

/**
 * Just the variation position on one project — no task figures (0024).
 *
 * The project page needs this and nothing else: the Overview says what the
 * approved variations are worth and what that does to the budget, and it does
 * NOT show them one by one, which is what the variations route is for.
 * Calling `getVariations` for it would re-read the schedule and the whole
 * project bundle a second time on every project page load to build figures
 * nothing on that page renders.
 *
 * Null when `0024` has not been run — the Overview then says nothing at all,
 * which is right: no table is not the same statement as no variations.
 */
export async function getVariationRollup(
  projectId: string
): Promise<VariationRollup | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("variations")
    .select("status, cost_impact, days_impact")
    .eq("project_id", projectId);
  if (missingRelation(error)) return null;
  return variationRollup((data ?? []) as Variation[]);
}

/**
 * Every variation on one project, each shown against what its task has
 * actually cost and how far it has actually drifted (migration 0024).
 *
 * This re-reads the schedule and the invoice lines rather than taking them
 * from the project page's bundle, deliberately: variations are their own
 * route, reached directly, and a loader that only works once another screen
 * has run is a loader waiting to break.
 */
export async function getVariations(
  projectId: string
): Promise<VariationList | null> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) return null;

  const { data: variations, error } = await supabase
    .from("variations")
    .select("*")
    .eq("project_id", projectId);
  if (missingRelation(error)) return null;

  // Both tolerated: a variation is worth recording even on a project whose
  // schedule has not been built. It simply shows no task figures beside it.
  const [bundle, projectBundle] = await Promise.all([
    getScheduleBundle(projectId).catch(() => null),
    getProjectBundle(projectId).catch(() => null),
  ]);

  const scheduled = bundle ? scheduleProject(bundle).tasks : [];
  const costs =
    bundle && projectBundle
      ? taskCostRows(
          bundle.tasks,
          projectBundle.invoiceLines,
          projectBundle.purchases,
          projectBundle.entries
        )
      : [];

  const phaseList = (bundle?.phases ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }));

  return {
    project: project as Project,
    variations: variationViews(
      (variations ?? []) as Variation[],
      costs,
      scheduled,
      new Map(phaseList.map((p) => [p.id, p.name]))
    ),
    rollup: variationRollup((variations ?? []) as Variation[]),
    phases: phaseList,
    tasks: (bundle?.tasks ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}
