/**
 * One chart theme, shared by every chart in the app.
 *
 * The old charts painted their three series in three steps of the brand green
 * (`#0f5d4a`, `#1f9e7f`, `#9fd3c4`). That is a *sequential* ramp — one hue,
 * light to dark, which encodes magnitude — doing a *categorical* job, where the
 * three series have no order at all. It also failed on contrast: the lightest
 * step sat at 1.6:1 against the card, so the VAT band was barely visible.
 *
 * These three hues were checked with a palette validator rather than by eye:
 * all three sit in the usable lightness band, clear the chroma floor, clear 3:1
 * contrast against the chart surface, and keep ΔE ≥ 9.6 between adjacent pairs
 * under protanopia (≥ 25.7 for normal vision). Reordering them or swapping one
 * for a nearby tint breaks those margins — re-validate if you change them.
 *
 * Assign these in fixed order and never cycle: a series keeps its colour when
 * another is filtered out, so the reader's mental mapping survives.
 */
export const SERIES = ["#0d8f6e", "#d95f1e", "#5468e8"] as const;

/** Named slots, so a call site says what it means rather than an index. */
export const SERIES_COLOR = {
  labour: SERIES[0],
  materials: SERIES[1],
  vat: SERIES[2],
} as const;

/** Recessive chrome: the grid and axes must never compete with the data. */
export const CHART_INK = {
  grid: "#e3e6e4",
  axis: "#9aa29d",
  label: "#535c57",
} as const;

export const AXIS_TICK = { fontSize: 11, fill: CHART_INK.axis } as const;

/** Tooltip surface, matched to the app's `.card` rather than Recharts' default. */
export const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: 14,
    border: "1px solid #e3e6e4",
    boxShadow:
      "0 8px 24px -6px rgb(23 27 25 / 0.16), 0 2px 8px -2px rgb(23 27 25 / 0.08)",
    fontSize: 13,
    padding: "8px 12px",
  },
  labelStyle: { fontWeight: 700, color: "#171b19", marginBottom: 4 },
  itemStyle: { padding: "1px 0", color: "#535c57" },
  cursor: { fill: "rgba(23,27,25,0.04)" },
} as const;

/** Legend text wears an ink token, never the series colour. */
export const LEGEND_STYLE = {
  fontSize: 12,
  color: CHART_INK.label,
  paddingTop: 8,
} as const;
