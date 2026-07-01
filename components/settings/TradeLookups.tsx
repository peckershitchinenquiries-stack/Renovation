"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useToast } from "@/components/ui/Toast";
import { Skeleton, EmptyState } from "@/components/ui/States";
import type { TradeLookup } from "@/types";

export default function TradeLookups() {
  const toast = useToast();
  const [rows, setRows] = useState<TradeLookup[] | null>(null);
  const [adding, setAdding] = useState({
    name: "",
    default_rate: "",
    default_markup_pct: "",
  });

  async function load() {
    try {
      setRows(await apiFetch<TradeLookup[]>("/api/lookups/trades"));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load trades", "error");
      setRows([]);
    }
  }
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function updateRow(row: TradeLookup, patch: Partial<TradeLookup>) {
    try {
      const saved = await apiFetch<TradeLookup>(
        `/api/lookups/trades/${row.id}`,
        { method: "PATCH", body: JSON.stringify(patch) }
      );
      setRows((r) => (r ? r.map((x) => (x.id === saved.id ? saved : x)) : r));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
      load();
    }
  }

  async function deleteRow(row: TradeLookup) {
    try {
      await apiFetch(`/api/lookups/trades/${row.id}`, { method: "DELETE" });
      setRows((r) => (r ? r.filter((x) => x.id !== row.id) : r));
      toast("Trade deleted", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  async function addRow(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.name.trim()) {
      toast("Trade name is required", "error");
      return;
    }
    try {
      const created = await apiFetch<TradeLookup>("/api/lookups/trades", {
        method: "POST",
        body: JSON.stringify({
          name: adding.name.trim(),
          default_rate: Number(adding.default_rate || 0),
          default_markup_pct: Number(adding.default_markup_pct || 0),
        }),
      });
      setRows((r) => (r ? [...r, created] : [created]));
      setAdding({ name: "", default_rate: "", default_markup_pct: "" });
      toast("Trade added", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Add failed", "error");
    }
  }

  if (rows === null)
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No trades"
            description="Add a trade below. Defaults are seeded on first login."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-2">Trade</th>
                <th className="py-2 pr-2">Rate (£/hr)</th>
                <th className="py-2 pr-2">Markup %</th>
                <th className="py-2 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-2">
                    <input
                      className="input h-9 py-1"
                      defaultValue={row.name}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value !== row.name)
                          updateRow(row, { name: e.target.value.trim() });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input h-9 w-24 py-1"
                      defaultValue={row.default_rate}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== Number(row.default_rate))
                          updateRow(row, { default_rate: v });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input h-9 w-24 py-1"
                      defaultValue={row.default_markup_pct}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== Number(row.default_markup_pct))
                          updateRow(row, { default_markup_pct: v });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => deleteRow(row)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form onSubmit={addRow} className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">New trade</label>
          <input
            className="input w-48"
            value={adding.name}
            onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))}
            placeholder="e.g. Scaffolder"
          />
        </div>
        <div>
          <label className="label">Rate (£/hr)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="input w-28"
            value={adding.default_rate}
            onChange={(e) =>
              setAdding((a) => ({ ...a, default_rate: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="label">Markup %</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="input w-28"
            value={adding.default_markup_pct}
            onChange={(e) =>
              setAdding((a) => ({ ...a, default_markup_pct: e.target.value }))
            }
          />
        </div>
        <button type="submit" className="btn-primary">
          Add trade
        </button>
      </form>
      <p className="text-xs text-gray-400">
        A trade can&apos;t be deleted while expense entries still reference it.
        Inline edits save when you click away from a field.
      </p>
    </div>
  );
}
