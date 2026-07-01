import React from "react";

const STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-gray-200 text-gray-700",
  paused: "bg-amber-100 text-amber-800",
  Paid: "bg-emerald-100 text-emerald-800",
  Partial: "bg-amber-100 text-amber-800",
  Pending: "bg-gray-200 text-gray-700",
  Planned: "bg-blue-100 text-blue-800",
  "In Progress": "bg-amber-100 text-amber-800",
  Cancelled: "bg-red-100 text-red-700",
};

export function Badge({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STYLES[label] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {label}
    </span>
  );
}
