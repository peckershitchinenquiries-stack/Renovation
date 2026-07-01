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

export function WeeklySpendChart({ data }: { data: WeekTotal[] }) {
  if (!data.length)
    return <p className="py-8 text-center text-sm text-gray-400">No weekly data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="week_number"
          tickFormatter={(w) => `W${w}`}
          fontSize={12}
        />
        <YAxis fontSize={12} width={48} />
        <Tooltip
          formatter={(value: number) => formatCurrency(value)}
          labelFormatter={(w) => `Week ${w}`}
        />
        <Legend />
        <Bar dataKey="labour" stackId="a" name="Labour" fill="#0f5d4a" />
        <Bar dataKey="materials" stackId="a" name="Materials" fill="#1f9e7f" />
        <Bar dataKey="vat" stackId="a" name="VAT" fill="#9fd3c4" />
      </BarChart>
    </ResponsiveContainer>
  );
}
