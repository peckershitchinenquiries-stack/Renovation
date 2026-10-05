// PDF export document — the full project report (cover, budget summary, week
// table, trades, suppliers). Uses @react-pdf/renderer.
//
// Like the Excel workbook, every table here is built by the function that builds
// the screen it is named after — the Trades and Suppliers tables come from the
// Analysis tab's own builders. They used to come from a second set in
// lib/summary.ts that grouped whole documents by a different rule and required a
// category the invoice extractor never sets, so the Materials table came out
// almost empty and the trade totals did not reconcile with the screen they were
// printed from. This is the document that gets handed to an accountant or a
// lender; it has to add up to the app. See lib/export.ts and about.md §6.10.
//
// Rollups only, deliberately. The Excel workbook carries the line-by-line
// Materials, Labour and Prices sheets; a PDF with one row per invoice line would
// run to hundreds of pages and nobody reads it.
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  Project,
  ExpenseEntryComputed,
  ProjectSummary,
  TradeInvoiceRow,
  SupplierInvoiceRow,
} from "@/types";

const BRAND = "#0f5d4a";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  cover: { padding: 60, backgroundColor: BRAND, color: "#fff", height: "100%" },
  coverTitle: { fontSize: 34, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  coverSub: { fontSize: 14, color: "#cdeae0" },
  coverMeta: { fontSize: 10, color: "#9fd3c4", marginTop: 24, lineHeight: 1.6 },
  h2: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: BRAND,
    marginTop: 18,
    marginBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: BRAND,
    paddingBottom: 4,
  },
  row: { flexDirection: "row" },
  cardRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  card: {
    width: "31%",
    border: "1pt solid #e2e2e2",
    borderRadius: 4,
    padding: 8,
  },
  cardLabel: { fontSize: 8, color: "#666" },
  cardValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 3 },
  th: {
    backgroundColor: BRAND,
    color: "#fff",
    padding: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  td: { padding: 4, fontSize: 8, borderBottom: "0.5pt solid #e2e2e2" },
  // The total line under a table, and the sentence under that saying which rows
  // the table covered. Both exist so the reader can reconcile the figure against
  // the screen without adding the rows up by hand or guessing at the basis.
  tdTotal: {
    padding: 4,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    borderTopWidth: 1,
    borderTopColor: BRAND,
  },
  note: { fontSize: 7, color: "#666", marginTop: 4, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#999",
    textAlign: "center",
  },
});

const money = (n: number) => `£${(Number(n) || 0).toFixed(2)}`;

function Cell({ children, w }: { children: React.ReactNode; w: string }) {
  return <Text style={{ ...s.td, width: w }}>{children}</Text>;
}
function HCell({ children, w }: { children: React.ReactNode; w: string }) {
  return <Text style={{ ...s.th, width: w }}>{children}</Text>;
}

// Σ of one money field over a set of rows, for the total line under each table.
// The totals are the whole reason the tables are here — without them a reader has
// to add fourteen rows up by hand to check the figure against the Overview.
const sum = <T,>(rows: T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);

export function ProjectReport({
  project,
  entries,
  summary,
  trades,
  suppliers,
}: {
  project: Project;
  /** Costs tab rows: diary + invoice-derived, ledger excluded by the caller. */
  entries: ExpenseEntryComputed[];
  summary: ProjectSummary;
  /** Analysis → By trade. */
  trades: TradeInvoiceRow[];
  /** Analysis → By supplier. */
  suppliers: SupplierInvoiceRow[];
}) {
  const byWeek = entries.slice().sort((a, b) => a.week_number - b.week_number);
  const today = new Date().toISOString().slice(0, 10);
  // Nothing was agreed in advance → the two quote figures are absent rather than
  // £0.00, and Variance needs the agreed figures to cover the whole cost before
  // it means anything. Same rule as the Overview cards and the workbook (C2).
  const committed = summary.total_quoted > 0.005;
  const fullyCommitted = committed && summary.quoted_coverage >= 0.995;
  return (
    <Document>
      {/* Cover */}
      <Page size="A4">
        <View style={s.cover}>
          <Text style={s.coverTitle}>RenovaTrack</Text>
          <Text style={s.coverSub}>Project Cost Report</Text>
          <View style={s.coverMeta}>
            <Text>{project.name}</Text>
            <Text>Status: {project.status}</Text>
            <Text>Generated: {today}</Text>
          </View>
        </View>
      </Page>

      {/* Report */}
      <Page size="A4" style={s.page}>
        <Text style={s.h2}>Budget Summary</Text>
        <View style={s.cardRow}>
          {[
            ["Budget", money(summary.target_budget)],
            // "—" when nothing was agreed in advance, matching the Overview
            // cards, which hide rather than print a £0.00 that cannot be wrong.
            [
              "Committed",
              committed
                ? `${money(summary.total_quoted)} (${Math.round(
                    summary.quoted_coverage * 100
                  )}% of cost)`
                : "—",
            ],
            ["Cost", money(summary.forecast_total)],
            [
              "Variance vs Committed",
              fullyCommitted ? money(summary.variance) : "—",
            ],
            ["Paid", money(summary.paid_to_date)],
            ["Owed", money(summary.remaining_to_pay)],
            ["Weeks tracked", String(summary.weeks_tracked)],
          ].map(([label, value]) => (
            <View style={s.card} key={label}>
              <Text style={s.cardLabel}>{label}</Text>
              <Text style={s.cardValue}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2}>Week-by-Week</Text>
        <View style={s.row}>
          <HCell w="8%">Wk</HCell>
          <HCell w="34%">Description</HCell>
          <HCell w="16%">Category</HCell>
          <HCell w="14%">Status</HCell>
          <HCell w="28%">Total incl. VAT</HCell>
        </View>
        {byWeek.map((e) => (
          <View style={s.row} key={e.id}>
            <Cell w="8%">{String(e.week_number)}</Cell>
            <Cell w="34%">{e.description}</Cell>
            <Cell w="16%">{e.category ?? "—"}</Cell>
            <Cell w="14%">{e.status}</Cell>
            <Cell w="28%">{money(e.total_incl_vat)}</Cell>
          </View>
        ))}

        {/* Both tables below cover INVOICES only, which is what the Analysis
            tab reports and what these builders are for. The Week-by-Week table
            above covers every cost row. They are not meant to add up to each
            other, and the note under each one says so — a reader who assumes
            they should will conclude a figure has gone missing. */}
        <Text style={s.h2}>Trades — from invoices</Text>
        <View style={s.row}>
          <HCell w="28%">Trade</HCell>
          <HCell w="10%">Inv.</HCell>
          <HCell w="16%">Net</HCell>
          <HCell w="16%">Cost</HCell>
          <HCell w="15%">Paid</HCell>
          <HCell w="15%">Owed</HCell>
        </View>
        {trades.map((t) => (
          <View style={s.row} key={t.trade}>
            <Cell w="28%">{t.trade}</Cell>
            <Cell w="10%">{String(t.invoice_count)}</Cell>
            <Cell w="16%">{money(t.net)}</Cell>
            <Cell w="16%">{money(t.gross)}</Cell>
            <Cell w="15%">{money(t.paid)}</Cell>
            <Cell w="15%">{money(t.balance)}</Cell>
          </View>
        ))}
        {trades.length === 0 ? (
          <Text style={s.note}>No invoices filed against this project yet.</Text>
        ) : (
          <View style={s.row}>
            <Text style={{ ...s.tdTotal, width: "28%" }}>Total</Text>
            <Text style={{ ...s.tdTotal, width: "10%" }}>
              {String(sum(trades, (t) => t.invoice_count))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "16%" }}>
              {money(sum(trades, (t) => t.net))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "16%" }}>
              {money(sum(trades, (t) => t.gross))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "15%" }}>
              {money(sum(trades, (t) => t.paid))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "15%" }}>
              {money(sum(trades, (t) => t.balance))}
            </Text>
          </View>
        )}
        <Text style={s.note}>
          Invoices only, grouped by the Trade field on each document — the same
          figures as the Analysis tab&apos;s By trade view. Hand-entered cost rows
          are in Week-by-Week above and are not counted here.
        </Text>

        <Text style={s.h2}>Suppliers — from invoices</Text>
        <View style={s.row}>
          <HCell w="28%">Supplier</HCell>
          <HCell w="10%">Inv.</HCell>
          <HCell w="16%">Net</HCell>
          <HCell w="16%">VAT</HCell>
          <HCell w="15%">Cost</HCell>
          <HCell w="15%">Owed</HCell>
        </View>
        {suppliers.map((m) => (
          <View style={s.row} key={m.supplier_id ?? m.supplier}>
            <Cell w="28%">{m.supplier}</Cell>
            <Cell w="10%">{String(m.invoice_count)}</Cell>
            <Cell w="16%">{money(m.net)}</Cell>
            <Cell w="16%">{money(m.vat)}</Cell>
            <Cell w="15%">{money(m.gross)}</Cell>
            <Cell w="15%">{money(m.balance)}</Cell>
          </View>
        ))}
        {suppliers.length === 0 ? (
          <Text style={s.note}>No invoices filed against this project yet.</Text>
        ) : (
          <View style={s.row}>
            <Text style={{ ...s.tdTotal, width: "28%" }}>Total</Text>
            <Text style={{ ...s.tdTotal, width: "10%" }}>
              {String(sum(suppliers, (m) => m.invoice_count))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "16%" }}>
              {money(sum(suppliers, (m) => m.net))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "16%" }}>
              {money(sum(suppliers, (m) => m.vat))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "15%" }}>
              {money(sum(suppliers, (m) => m.gross))}
            </Text>
            <Text style={{ ...s.tdTotal, width: "15%" }}>
              {money(sum(suppliers, (m) => m.balance))}
            </Text>
          </View>
        )}
        <Text style={s.note}>
          The same invoices as the table above, grouped by who they came from —
          the Analysis tab&apos;s By supplier view. The two totals are the same
          money counted two ways; do not add them together. Item-by-item detail,
          and the unit prices behind it, are in the Excel export.
        </Text>

        <Text style={s.footer} fixed>
          RenovaTrack — {project.name} — generated {today}
        </Text>
      </Page>
    </Document>
  );
}
