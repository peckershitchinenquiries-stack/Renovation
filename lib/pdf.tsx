// PDF export document — full project report (cover, budget summary, week table,
// trades summary, materials summary). Uses @react-pdf/renderer.
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
  TradeSummary,
  MaterialSummary,
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

export function ProjectReport({
  project,
  entries,
  summary,
  trades,
  materials,
}: {
  project: Project;
  entries: ExpenseEntryComputed[];
  summary: ProjectSummary;
  trades: TradeSummary[];
  materials: MaterialSummary[];
}) {
  const byWeek = entries.slice().sort((a, b) => a.week_number - b.week_number);
  const today = new Date().toISOString().slice(0, 10);
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
            ["Target Budget", money(summary.target_budget)],
            ["Total Quoted", money(summary.total_quoted)],
            ["Actual Total", money(summary.forecast_total)],
            ["Variance vs Quote", money(summary.variance)],
            ["Paid to Date", money(summary.paid_to_date)],
            ["Remaining to Pay", money(summary.remaining_to_pay)],
            ["Weeks Tracked", String(summary.weeks_tracked)],
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

        <Text style={s.h2}>Trades Summary</Text>
        <View style={s.row}>
          <HCell w="34%">Trade</HCell>
          <HCell w="22%">Actual</HCell>
          <HCell w="22%">Paid</HCell>
          <HCell w="22%">Remaining</HCell>
        </View>
        {trades.map((t) => (
          <View style={s.row} key={t.trade}>
            <Cell w="34%">{t.trade}</Cell>
            <Cell w="22%">{money(t.actual)}</Cell>
            <Cell w="22%">{money(t.paid)}</Cell>
            <Cell w="22%">{money(t.remaining)}</Cell>
          </View>
        ))}

        <Text style={s.h2}>Materials Summary</Text>
        <View style={s.row}>
          <HCell w="40%">Supplier</HCell>
          <HCell w="20%">Cost</HCell>
          <HCell w="20%">VAT</HCell>
          <HCell w="20%">Total</HCell>
        </View>
        {materials.map((m) => (
          <View style={s.row} key={m.supplier}>
            <Cell w="40%">{m.supplier}</Cell>
            <Cell w="20%">{money(m.cost)}</Cell>
            <Cell w="20%">{money(m.vat)}</Cell>
            <Cell w="20%">{money(m.total)}</Cell>
          </View>
        ))}

        <Text style={s.footer} fixed>
          RenovaTrack — {project.name} — generated {today}
        </Text>
      </Page>
    </Document>
  );
}
