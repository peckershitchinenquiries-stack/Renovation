"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateContact, hasErrors } from "@/lib/validation";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { CONTACT_STATUSES, type Contact, type TradeLookup } from "@/types";

/**
 * A person in the trades register (migration 0020).
 *
 * Two rates, not one, because both get quoted and they are not
 * interchangeable: a day rate is what a subcontractor charges to turn up, an
 * hourly rate is what a jobbing plumber charges for two hours. Both are
 * optional — the Gantt's cost-impact chip prefers the day rate, says which
 * rate it used, and refuses to guess when neither is on file rather than
 * pricing a delay at £0 (about.md §18).
 *
 * `trades` is a free-text list matched against `trade_lookups.name` by
 * convention only, exactly like `tasks.trade` and `purchases.trade` — no
 * foreign key, so renaming a trade lookup never rewrites who did what.
 */
export default function ContactForm({
  contact,
  trades = [],
  suppliers = [],
  onSaved,
  onCancel,
}: {
  contact?: Contact;
  /** For the trade suggestions. Optional — typing a new one is always allowed. */
  trades?: TradeLookup[];
  /** The optional bridge to the merchant register, for a subcontractor who
   *  also invoices as a limited company. */
  suppliers?: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(contact);
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    company: contact?.company ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    address: contact?.address ?? "",
    day_rate: contact?.day_rate?.toString() ?? "",
    hourly_rate: contact?.hourly_rate?.toString() ?? "",
    supplier_id: contact?.supplier_id ?? "",
    status: contact?.status ?? "active",
    notes: contact?.notes ?? "",
  });
  const [tradeList, setTradeList] = useState<string[]>(contact?.trades ?? []);
  const [tradeDraft, setTradeDraft] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  function addTrade(name: string) {
    const clean = name.trim();
    // Case-insensitive, because "Plasterer" and "plasterer" are one trade and
    // two chips saying the same word is just untidy data on screen.
    if (!clean) return;
    if (tradeList.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTradeDraft("");
      return;
    }
    setTradeList((list) => [...list, clean]);
    setTradeDraft("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, trades: tradeList };
    const v = validateContact(payload);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(
        editing ? `/api/contacts/${contact!.id}` : "/api/contacts",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      toast(editing ? "Saved" : "Added to the register", "success");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="contact-name">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="contact-name"
          className={`input ${errors.name ? "input-invalid" : ""}`}
          maxLength={200}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Dave Builder"
        />
        {errors.name && <p className="field-error">{errors.name}</p>}
      </div>

      <div>
        <label className="label" htmlFor="contact-company">
          Company
        </label>
        <input
          id="contact-company"
          className="input"
          maxLength={200}
          value={form.company ?? ""}
          onChange={(e) => set("company", e.target.value)}
          placeholder="If they trade as one"
        />
      </div>

      <div>
        <label className="label" htmlFor="contact-trade">
          Trades
        </label>
        {tradeList.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tradeList.map((trade) => (
              <span
                key={trade}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-xs font-semibold text-brand-800"
              >
                {trade}
                <button
                  type="button"
                  aria-label={`Remove ${trade}`}
                  onClick={() =>
                    setTradeList((list) => list.filter((t) => t !== trade))
                  }
                  className="rounded-full p-0.5 text-brand-600 hover:bg-brand-100"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            id="contact-trade"
            className="input flex-1"
            list="contact-trade-options"
            value={tradeDraft}
            onChange={(e) => setTradeDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the trade rather than submitting the form — a
              // half-typed chip is the last thing that should save the record.
              if (e.key === "Enter") {
                e.preventDefault();
                addTrade(tradeDraft);
              }
            }}
            placeholder="Plasterer"
          />
          <datalist id="contact-trade-options">
            {trades.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => addTrade(tradeDraft)}
          >
            Add
          </button>
        </div>
        <p className="hint">
          A person often does more than one. Type a new trade or pick a known
          one — nothing is locked to the trade list.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="contact-phone">
            Phone
          </label>
          <input
            id="contact-phone"
            type="tel"
            inputMode="tel"
            className="input"
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="contact-email">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            inputMode="email"
            className={`input ${errors.email ? "input-invalid" : ""}`}
            value={form.email ?? ""}
            onChange={(e) => set("email", e.target.value)}
          />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="contact-day-rate">
            Day rate
          </label>
          <input
            id="contact-day-rate"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className={`input ${errors.day_rate ? "input-invalid" : ""}`}
            value={form.day_rate}
            onChange={(e) => set("day_rate", e.target.value)}
            placeholder="220"
          />
          {errors.day_rate && <p className="field-error">{errors.day_rate}</p>}
        </div>
        <div>
          <label className="label" htmlFor="contact-hourly-rate">
            Hourly rate
          </label>
          <input
            id="contact-hourly-rate"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className={`input ${errors.hourly_rate ? "input-invalid" : ""}`}
            value={form.hourly_rate}
            onChange={(e) => set("hourly_rate", e.target.value)}
          />
          {errors.hourly_rate && (
            <p className="field-error">{errors.hourly_rate}</p>
          )}
        </div>
      </div>
      <p className="hint -mt-2">
        Used to price a delay on the Gantt. With neither on file the chip says
        so rather than showing £0 — a delay that reads as free is worse than no
        estimate.
      </p>

      <div>
        <label className="label" htmlFor="contact-address">
          Address
        </label>
        <textarea
          id="contact-address"
          className="textarea"
          rows={2}
          value={form.address ?? ""}
          onChange={(e) => set("address", e.target.value)}
        />
      </div>

      {suppliers.length > 0 ? (
        <div>
          <label className="label" htmlFor="contact-supplier">
            Also invoices as
          </label>
          <Select
            id="contact-supplier"
            title="Linked supplier"
            placeholder="Not a supplier"
            clearable
            value={form.supplier_id ?? ""}
            onChange={(v) => set("supplier_id", v)}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          <p className="hint">
            Only for a subcontractor who also invoices you as a company. A
            worker is not a supplier — labour is logged against a name, not a
            merchant account.
          </p>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="contact-status">
          Status
        </label>
        <Select
          id="contact-status"
          title="Status"
          value={form.status}
          onChange={(v) => set("status", v)}
          options={CONTACT_STATUSES.map((s) => ({
            value: s,
            label: s === "active" ? "Active" : "Inactive",
          }))}
        />
        <p className="hint">
          Somebody who has finished on this job is <strong>inactive</strong>,
          not deleted — that keeps their name on the work and the certificates
          they held, and stops them appearing in expiry warnings.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="contact-notes">
          Notes
        </label>
        <textarea
          id="contact-notes"
          className="textarea"
          rows={2}
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {editing ? "Save changes" : "Add to register"}
        </button>
      </div>
    </form>
  );
}
