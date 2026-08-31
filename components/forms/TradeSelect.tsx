"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { Spinner } from "@/components/ui/States";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/Icon";
import type { TradeLookup } from "@/types";

// Trade is still stored as a plain name string on expense_entries.trade and
// purchases.trade — there is no FK to trade_lookups, matching is by
// convention only (about.md §4.2/§4.6) — so picking from this list or typing
// a brand new one both just set that string. Nothing here needs a migration.
const ADD_NEW = "__add_new_trade__";

interface Props {
  id: string;
  value: string;
  trades: TradeLookup[];
  onChange: (name: string) => void;
  onTradeAdded?: (trade: TradeLookup) => void;
  className?: string;
}

export default function TradeSelect({
  id,
  value,
  trades,
  onChange,
  onTradeAdded,
  className = "input",
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A row edited before this select existed (or whose lookup was since
  // renamed or deleted) can hold a trade name that isn't in trade_lookups at
  // all. A plain <select> would show that as nothing selected, which reads as
  // "cleared" even though the stored value hasn't changed — so it gets its
  // own option instead, visibly marked, until the user actively picks
  // something else.
  const knownNames = new Set(trades.map((t) => t.name));
  const currentIsUnknown = value.trim() !== "" && !knownNames.has(value);

  function handleSelect(v: string) {
    if (v === ADD_NEW) {
      setAdding(true);
      setName("");
      setError(null);
      return;
    }
    onChange(v);
  }

  async function saveNewTrade() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Trade name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<TradeLookup>("/api/lookups/trades", {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      onTradeAdded?.(created);
      onChange(created.name);
      setAdding(false);
      setName("");
    } catch (err) {
      // trade_lookups has unique (user_id, name) — the route turns that
      // conflict into a 409 with a readable message, surfaced here at the
      // field rather than as a crash or a silent no-op.
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Could not add trade"
      );
    } finally {
      setSaving(false);
    }
  }

  if (adding) {
    return (
      <div>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <input
              id={id}
              className={`input ${error ? "input-invalid" : ""}`}
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New trade name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveNewTrade();
                }
              }}
            />
          </div>
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={saving}
            onClick={saveNewTrade}
          >
            {saving ? <Spinner /> : null}
            Save
          </button>
          <button
            type="button"
            aria-label="Cancel adding a trade"
            className="btn-icon shrink-0 border border-gray-200 text-gray-500"
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    );
  }

  // The "+ Add new trade" row stays an option in the list rather than becoming
  // a button beside it: adding a trade is something you discover *while*
  // looking for one that is not there, which is exactly when the list is open.
  return (
    <Select
      id={id}
      title="Trade"
      placeholder="No trade"
      clearable
      className={className === "input" ? "" : className}
      value={value}
      onChange={handleSelect}
      options={[
        ...(currentIsUnknown
          ? [{ value, label: value, hint: "Not in the trade list" }]
          : []),
        ...trades.map((t) => ({
          value: t.name,
          label: t.name,
          hint:
            Number(t.default_rate) > 0
              ? `£${Number(t.default_rate).toFixed(2)}/hr`
              : undefined,
        })),
        { value: ADD_NEW, label: "+ Add a new trade" },
      ]}
    />
  );
}
