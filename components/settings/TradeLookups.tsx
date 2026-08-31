"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useToast } from "@/components/ui/Toast";
import { Skeleton, EmptyState } from "@/components/ui/States";
import { SectionHeader } from "@/components/ui/PageHeader";
import { Sheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/Icon";
import { ListCard, ListRow } from "@/components/ui/List";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { TradeLookup } from "@/types";

/**
 * Default trade rates.
 *
 * This was a four-column table of inline `<input>`s that saved on blur. On a
 * phone that meant a horizontally-scrolling table of 96px-wide number fields,
 * and a save you could only trigger by tapping somewhere else — with no
 * confirmation that anything had happened.
 *
 * It is a list of rows now. Tapping one opens a sheet with room to type in and
 * an explicit Save. Every network call is unchanged: the same PATCH per row,
 * the same POST to add, the same DELETE.
 */

const BLANK = { name: "", default_rate: "", default_markup_pct: "" };

export default function TradeLookups() {
  const toast = useToast();
  const [rows, setRows] = useState<TradeLookup[] | null>(null);

  // `null` closed, a row for edit, "new" for add — one sheet serves both,
  // because they ask for exactly the same three things.
  const [editing, setEditing] = useState<TradeLookup | "new" | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TradeLookup | null>(null);

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

  function openAdd() {
    setForm(BLANK);
    setEditing("new");
  }

  function openEdit(row: TradeLookup) {
    setForm({
      name: row.name,
      default_rate: String(row.default_rate ?? ""),
      default_markup_pct: String(row.default_markup_pct ?? ""),
    });
    setEditing(row);
  }

  async function save() {
    if (!form.name.trim()) {
      toast("Trade name is required", "error");
      return;
    }
    setSaving(true);
    try {
      if (editing === "new") {
        const created = await apiFetch<TradeLookup>("/api/lookups/trades", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            default_rate: Number(form.default_rate || 0),
            default_markup_pct: Number(form.default_markup_pct || 0),
          }),
        });
        setRows((r) => (r ? [...r, created] : [created]));
        toast("Trade added", "success");
      } else if (editing) {
        const saved = await apiFetch<TradeLookup>(
          `/api/lookups/trades/${editing.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: form.name.trim(),
              default_rate: Number(form.default_rate || 0),
              default_markup_pct: Number(form.default_markup_pct || 0),
            }),
          }
        );
        setRows((r) => (r ? r.map((x) => (x.id === saved.id ? saved : x)) : r));
        toast("Trade updated", "success");
      }
      setEditing(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(row: TradeLookup) {
    try {
      await apiFetch(`/api/lookups/trades/${row.id}`, { method: "DELETE" });
      setRows((r) => (r ? r.filter((x) => x.id !== row.id) : r));
      toast("Trade deleted", "success");
      setEditing(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  if (rows === null)
    return (
      <section>
        <SectionHeader title="Trade rates" />
        <div className="card-flush row-divide">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="mt-2 h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );

  return (
    <section>
      <SectionHeader
        title="Trade rates"
        hint="Used to auto-fill labour rates on expenses"
        action={
          <button type="button" className="btn-secondary btn-sm" onClick={openAdd}>
            <Icon name="plus" size={15} strokeWidth={2.25} />
            Add
          </button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="hammer"
          compact
          title="No trades"
          description="Add a trade to auto-fill its rate on labour entries."
          action={
            <button type="button" className="btn-primary" onClick={openAdd}>
              <Icon name="plus" size={18} strokeWidth={2.25} />
              Add trade
            </button>
          }
        />
      ) : (
        <ListCard>
          {rows.map((row) => (
            <ListRow
              key={row.id}
              icon="hammer"
              iconTone="brand"
              title={row.name}
              subtitle={
                <span className="tnum">
                  £{Number(row.default_rate ?? 0).toFixed(2)}/hr
                  {Number(row.default_markup_pct ?? 0) > 0
                    ? ` · ${Number(row.default_markup_pct).toFixed(0)}% markup`
                    : ""}
                </span>
              }
              chevron
              onClick={() => openEdit(row)}
            />
          ))}
        </ListCard>
      )}

      <p className="hint mt-2">
        A trade can&apos;t be deleted while expense entries still reference it.
      </p>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add a trade" : "Edit trade"}
        size="sm"
        footer={
          <div className="flex gap-2">
            {editing && editing !== "new" ? (
              <button
                type="button"
                className="btn-danger-soft"
                aria-label="Delete trade"
                onClick={() => setConfirmDelete(editing)}
              >
                <Icon name="trash" size={17} />
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="trade-name">
              Trade
            </label>
            <input
              id="trade-name"
              data-autofocus
              className="input"
              placeholder="e.g. Scaffolder"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="trade-rate">
                Rate
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-semibold text-gray-400">
                  £
                </span>
                <input
                  id="trade-rate"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  className="input tnum pl-8"
                  value={form.default_rate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, default_rate: e.target.value }))
                  }
                />
              </div>
              <p className="hint">Per hour</p>
            </div>
            <div>
              <label className="label" htmlFor="trade-markup">
                Markup
              </label>
              <div className="relative">
                <input
                  id="trade-markup"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  className="input tnum pr-8"
                  value={form.default_markup_pct}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      default_markup_pct: e.target.value,
                    }))
                  }
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-semibold text-gray-400">
                  %
                </span>
              </div>
              <p className="hint">On materials</p>
            </div>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        danger
        title="Delete trade"
        confirmLabel="Delete"
        message={
          <>
            Delete &ldquo;{confirmDelete?.name}&rdquo;? This is only possible if
            no expense entry still refers to it.
          </>
        }
        onConfirm={() => {
          const t = confirmDelete;
          setConfirmDelete(null);
          if (t) void deleteRow(t);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}
