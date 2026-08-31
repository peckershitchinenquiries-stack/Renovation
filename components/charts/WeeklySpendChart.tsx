"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import type { WeekTotal } from "@/types";
import { formatCurrency } from "@/lib/calculations";
import {
  SERIES_COLOR,
  CHART_INK,
  AXIS_TICK,
  TOOLTIP_STYLE,
  LEGEND_STYLE,
} from "./theme";

/** Compact axis money: "£1.2k" beats "£1,200" on a 375px-wide chart. */
function shortMoney(v: number) {
  if (Math.abs(v) >= 1000) return `£${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `£${Math.round(v)}`;
}

export function WeeklySpendChart({ data }: { data: WeekTotal[] }) {
  if (!data.length)
    return (
      <p className="py-10 text-center text-sm text-gray-400">
        No weekly data yet.
      </p>
    );

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        {/* Horizontal rules only, in the palest ink — a full grid competes with
            the bars it is supposed to support. */}
        <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
        <XAxis
          dataKey="week_number"
          tickFormatter={(w) => `W${w}`}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.grid }}
        />
        <YAxis
          tick={AXIS_TICK}
          tickFormatter={shortMoney}
          width={52}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value: number) => formatCurrency(value)}
          labelFormatter={(w) => `Week ${w}`}
          {...TOOLTIP_STYLE}
        />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
        {/* 2px of surface between stacked segments, and a rounded cap on the
            topmost one only — the segments below it must stay square or the
            stack reads as separate bars. */}
        <Bar
          dataKey="labour"
          stackId="a"
          name="Labour"
          fill={SERIES_COLOR.labour}
          stroke="#fff"
          strokeWidth={2}
        />
        <Bar
          dataKey="materials"
          stackId="a"
          name="Materials"
          fill={SERIES_COLOR.materials}
          stroke="#fff"
          strokeWidth={2}
        />
        <Bar
          dataKey="vat"
          stackId="a"
          name="VAT"
          fill={SERIES_COLOR.vat}
          stroke="#fff"
          strokeWidth={2}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
