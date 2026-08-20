// Unit tests for buildMaterialPriceIndex — the merge that lets ExpenseForm's
// price-change warning compare against invoice line history as well as
// hand-entered expense_entries (see the "Expense form price advisories"
// section of lib/purchases.ts).
//
// Run with: node --experimental-strip-types --test lib/purchases.test.mts
// (Node's built-in test runner — this repo has no other test infrastructure,
// see CLAUDE.md.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMaterialPriceIndex, comparePrice } from "./purchases.ts";

// Minimal fixtures — only the fields buildMaterialPriceIndex reads.
function entry(overrides: Partial<Parameters<typeof buildMaterialPriceIndex>[0][number]> = {}) {
  return {
    id: "e1",
    description: "Plaster",
    category: "Materials" as const,
    status: "Paid" as const,
    source: "diary" as const,
    unit_cost: 10,
    supplier: "Wickes",
    paid_date: "2026-08-01",
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function line(overrides: Partial<Parameters<typeof buildMaterialPriceIndex>[1][number]> = {}) {
  return {
    description: "Plaster",
    unit_price: 12,
    unit: "bag",
    date: "2026-08-10",
    supplier: "Lawsons",
    entry_source: "diary" as const,
    ...overrides,
  };
}

test("matches an expense entry by normalised description", () => {
  const index = buildMaterialPriceIndex([entry()], []);
  const hit = index.get("plaster");
  assert.ok(hit);
  assert.equal(hit.unit_price, 10);
  assert.equal(hit.unit, null); // expense_entries has no unit column
  assert.equal(hit.supplier, "Wickes");
});

test("matches an invoice line by normalised description, unit carried through", () => {
  const index = buildMaterialPriceIndex([], [line()]);
  const hit = index.get("plaster");
  assert.ok(hit);
  assert.equal(hit.unit_price, 12);
  assert.equal(hit.unit, "bag");
  assert.equal(hit.supplier, "Lawsons");
});

test("normalisation ignores case and collapses whitespace, matching priceKey()", () => {
  const index = buildMaterialPriceIndex([entry({ description: "  PLASTER   bag " })], []);
  assert.ok(index.get("plaster bag"));
});

test("the most recent observation wins across both sources", () => {
  const index = buildMaterialPriceIndex(
    [entry({ unit_cost: 10, paid_date: "2026-08-01" })],
    [line({ unit_price: 12, date: "2026-08-10" })]
  );
  assert.equal(index.get("plaster")!.unit_price, 12);
});

test("an earlier invoice line does not overwrite a later expense entry", () => {
  const index = buildMaterialPriceIndex(
    [entry({ unit_cost: 10, paid_date: "2026-08-20" })],
    [line({ unit_price: 12, date: "2026-08-01" })]
  );
  assert.equal(index.get("plaster")!.unit_price, 10);
});

test("R8: a unit price of 0 or less is not a price, on either side", () => {
  const index = buildMaterialPriceIndex(
    [entry({ unit_cost: 0 })],
    [line({ unit_price: 0 })]
  );
  assert.equal(index.get("plaster"), undefined);
});

test("excludes cancelled expense entries", () => {
  const index = buildMaterialPriceIndex([entry({ status: "Cancelled" })], []);
  assert.equal(index.get("plaster"), undefined);
});

test("excludes ledger-sourced expense entries and ledger-sourced invoice lines", () => {
  const index = buildMaterialPriceIndex(
    [entry({ source: "ledger" })],
    [line({ entry_source: "ledger" })]
  );
  assert.equal(index.get("plaster"), undefined);
});

test("excludes non-Materials expense entries", () => {
  const index = buildMaterialPriceIndex([entry({ category: "Labour" })], []);
  assert.equal(index.get("plaster"), undefined);
});

test("excludes the entry currently being edited", () => {
  const index = buildMaterialPriceIndex([entry({ id: "e1" })], [], "e1");
  assert.equal(index.get("plaster"), undefined);
});

test("R6: comparePrice against the merged result suppresses the percentage on a unit mismatch", () => {
  // ExpenseForm's typed unit cost has no unit of its own, so it is always
  // compared as unit: null — mirroring what priceWarning does.
  const index = buildMaterialPriceIndex([], [line({ unit: "bag" })]);
  const previous = index.get("plaster")!;
  const { delta_pct, move } = comparePrice(
    { unit_price: 15, unit: null },
    { unit_price: previous.unit_price, unit: previous.unit }
  );
  assert.equal(move, "unit_change");
  assert.equal(delta_pct, null);
});

test("R6: two unit-less observations (expense-vs-expense) still compare with a percentage", () => {
  const index = buildMaterialPriceIndex([entry({ unit_cost: 10 })], []);
  const previous = index.get("plaster")!;
  const { delta_pct, move } = comparePrice(
    { unit_price: 15, unit: null },
    { unit_price: previous.unit_price, unit: previous.unit }
  );
  assert.equal(move, "up");
  assert.equal(delta_pct, 50);
});
