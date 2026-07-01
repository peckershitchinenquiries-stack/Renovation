"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CategoryTotal } from "@/types";
import { formatCurrency } from "@/lib/calculations";

const COLORS = ["#0f5d4a", "#1f9e7f"];

export function CategoryDonut({ data }: { data: CategoryTotal[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  if (total <= 0)
    return <p className="py-8 text-center text-sm text-gray-400">No category data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="total"
          nameKey="category"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => formatCurrency(value)} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
