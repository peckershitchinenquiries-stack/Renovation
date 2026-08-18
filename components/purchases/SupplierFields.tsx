"use client";

import { useId } from "react";

export interface SupplierFieldsValue {
  name: string;
  vat_number: string;
  address: string;
}

// Name, VAT number, address — the fields for creating a supplier record.
//
// Used inline by the invoice review screen's "add new supplier" panel
// (invoice-ingestion-prompt.md, Phase 5: "the inline new-supplier form must
// be the same component as the standalone supplier-creation form"). There is
// no standalone supplier-creation screen yet — /suppliers is still read-only
// (about.md §8.1) — so this is that shared component, built now so the day a
// standalone one is added it reuses this rather than growing a second copy.
export function SupplierFields({
  value,
  onChange,
  errors,
}: {
  value: SupplierFieldsValue;
  onChange: (patch: Partial<SupplierFieldsValue>) => void;
  errors?: { name?: string };
}) {
  const uid = useId();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="sm:col-span-1">
        <label className="label" htmlFor={`${uid}-name`}>
          Supplier name
        </label>
        <input
          id={`${uid}-name`}
          className="input"
          autoComplete="off"
          maxLength={200}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {errors?.name && <p className="field-error">{errors.name}</p>}
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-vat`}>
          VAT number
        </label>
        <input
          id={`${uid}-vat`}
          className="input"
          autoComplete="off"
          value={value.vat_number}
          onChange={(e) => onChange({ vat_number: e.target.value })}
          placeholder="e.g. GB123456789"
        />
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-address`}>
          Address
        </label>
        <input
          id={`${uid}-address`}
          className="input"
          autoComplete="off"
          value={value.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </div>
    </div>
  );
}
