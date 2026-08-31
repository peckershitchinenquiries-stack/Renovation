"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CategoryTotal } from "@/types";
import { formatCurrency } from "@/lib/calculations";
import { SERIES, TOOLTIP_STYLE, LEGEND_STYLE } from "./theme";

export function CategoryDonut({ data }: { data: CategoryTotal[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  if (total <= 0)
    return (
      <p className="py-10 text-center text-sm text-gray-400">
        No category data yet.
      </p>
    );

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="category"
            innerRadius={66}
            outerRadius={92}
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((d, i) => (
              // Fixed order, never cycled: a category keeps its colour even if
              // another one drops to zero and disappears from the ring.
              <Cell key={d.category} fill={SERIES[i % SERIES.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => formatCurrency(value)}
            {...TOOLTIP_STYLE}
          />
          <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
        </PieChart>
      </ResponsiveContainer>

      {/* The hole in a donut is wasted unless it carries the total the segments
          add up to — otherwise the reader has to sum the tooltips themselves. */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(120px-1.6rem)] text-center">
        <p className="tnum text-lg font-bold leading-none tracking-[-0.02em] text-gray-900">
          {formatCurrency(total)}
        </p>
        <p className="mt-1 text-2xs font-medium text-gray-500">Total</p>
      </div>
    </div>
  );
}
