"use client";

import { Fragment, useState, type ReactNode } from "react";

/**
 * The one table shell behind every Analysis pivot.
 *
 * Trades, Suppliers, Materials, Labour and Price history were five components
 * that read the same data — invoice lines and purchases — grouped by a
 * different column. Five copies of the same markup meant five places to fix a
 * responsive bug and five totals rows that could quietly disagree. They are one
 * component now; a segment supplies its column set and nothing else.
 *
 * It keeps the rule from about.md §8: every data table renders twice, a
 * `sm:hidden` card list and a `hidden sm:block` table, from the same array. A
 * column added here appears in the table; the matching card is the segment's
 * `card` render prop, and both come from this one `rows` array so they cannot
 * drift out of sync by row.
 */

export type PivotColumn<T> = {
  key: string;
  header: ReactNode;
  /** `title` attribute on the header cell — the MONEY hints use this. */
  title?: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  /**
   * This column's cell in the totals row. The label sits in a `colSpan` across
   * every column before the first one that defines a `foot`, which is how the
   * old five tables all looked.
   */
  foot?: ReactNode;
};

export default function PivotTable<T>({
  rows,
  columns,
  rowKey,
  card,
  expand,
  expandable,
  expandLabel = "Lines",
  footLabel,
  mobileTotals,
}: {
  rows: T[];
  columns: PivotColumn<T>[];
  rowKey: (row: T) => string;
  /** The `sm:hidden` card for one row. Gets the expander so a card can use it. */
  card: (row: T, expander: { expanded: boolean; toggle: () => void }) => ReactNode;
  /**
   * Detail panel under a row. Built only for the one open row — a supplier's
   * panel filters every line on the project, so building all of them to decide
   * which rows get a toggle would be quadratic. `expandable` answers that
   * question cheaply instead.
   */
  expand?: (row: T) => ReactNode;
  expandable?: (row: T) => boolean;
  expandLabel?: string;
  footLabel?: ReactNode;
  mobileTotals?: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);

  // Only one row is ever open, which is what the Suppliers and Price tables
  // already did separately.
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));

  const hasFoot = columns.some((c) => c.foot !== undefined);
  const firstFoot = columns.findIndex((c) => c.foot !== undefined);
  const totalColumns = columns.length + (expand ? 1 : 0);

  return (
    <>
      {/* Mobile: one card per row, plus the same totals the table foots with. */}
      <div className="space-y-2.5 sm:hidden">
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <Fragment key={key}>
              {card(row, {
                expanded: open === key,
                toggle: () => toggle(key),
              })}
            </Fragment>
          );
        })}
        {mobileTotals}
      </div>

      {/* Desktop: table. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
              {columns.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  className={`pb-2.5 pr-3 ${
                    c.align === "right" ? "text-right" : ""
                  }`}
                >
                  {c.header}
                </th>
              ))}
              {expand && (
                <th className="pb-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200/70">
            {rows.map((row) => {
              const key = rowKey(row);
              const isOpen = open === key;
              // A row with nothing to show gets no control rather than an
              // empty drawer.
              const canExpand = expand
                ? expandable
                  ? expandable(row)
                  : true
                : false;
              const detail = expand && isOpen && canExpand ? expand(row) : null;
              return (
                <Fragment key={key}>
                  <tr className="align-top">
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`py-2.5 pr-3 ${
                          c.align === "right" ? "tnum text-right" : ""
                        }`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                    {expand && (
                      <td className="py-2.5 text-right">
                        {canExpand ? (
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-brand-700"
                            onClick={() => toggle(key)}
                          >
                            {isOpen ? "Hide" : expandLabel}
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                  {detail && (
                    <tr>
                      <td colSpan={totalColumns} className="bg-gray-50 px-3 py-3">
                        {detail}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {hasFoot && (
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-bold text-gray-900">
                {firstFoot > 0 && (
                  <td className="py-2.5 pr-3" colSpan={firstFoot}>
                    {footLabel}
                  </td>
                )}
                {columns.slice(Math.max(firstFoot, 0)).map((c) => (
                  <td
                    key={c.key}
                    className={`py-2.5 pr-3 ${
                      c.align === "right" ? "tnum text-right" : ""
                    }`}
                  >
                    {c.foot}
                  </td>
                ))}
                {expand && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
