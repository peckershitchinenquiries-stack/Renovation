// Shared validation (runs both client-side and server-side per requirements §10).
import {
  ACTIVITY_KINDS,
  CERTIFICATION_KINDS,
  CONTACT_STATUSES,
  DEP_TYPES,
  DOC_TYPES,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  PHASE_COLOURS,
  PO_STATUSES,
  REASON_CODES,
  SIGNOFF_OUTCOMES,
  SNAG_SEVERITIES,
  SNAG_STATUSES,
  TASK_STATUSES,
  VARIATION_STATUSES,
  VAT_RATES_SENTENCE,
  isVatRate,
} from "@/types";

export type ValidationErrors = Record<string, string>;

const num = (v: unknown) => (v === "" || v == null ? 0 : Number(v));

export function validateProject(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};
  const name = String(data.name ?? "").trim();
  if (!name) errors.name = "Name is required";
  if (name.length > 200) errors.name = "Max 200 characters";
  if (num(data.target_budget) < 0) errors.target_budget = "Must be non-negative";
  if (data.status && !["active", "completed", "paused"].includes(String(data.status)))
    errors.status = "Invalid status";

  if (data.start_date && !isDate(data.start_date)) errors.start_date = "Use a real date";
  if (data.planned_end_date && !isDate(data.planned_end_date))
    errors.planned_end_date = "Use a real date";
  if (
    isDate(data.start_date) &&
    isDate(data.planned_end_date) &&
    String(data.planned_end_date) < String(data.start_date)
  )
    errors.planned_end_date = "The finish cannot be before the start";

  return errors;
}

export function validateExpense(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};

  const week = num(data.week_number);
  if (!Number.isInteger(week) || week < 1)
    errors.week_number = "Week must be a positive integer";

  const description = String(data.description ?? "").trim();
  if (!description) errors.description = "Description is required";
  if (description.length > 200) errors.description = "Max 200 characters";

  if (data.category && !EXPENSE_CATEGORIES.includes(data.category as never))
    errors.category = "Invalid category";

  if (num(data.quoted_amount) < 0) errors.quoted_amount = "Must be non-negative";
  if (num(data.actual_amount) < 0) errors.actual_amount = "Must be non-negative";
  if (num(data.paid_amount) < 0) errors.paid_amount = "Must be non-negative";
  if (num(data.qty) < 0) errors.qty = "Must be non-negative";
  if (num(data.unit_cost) < 0) errors.unit_cost = "Must be non-negative";

  if (!isVatRate(num(data.vat_rate)))
    errors.vat_rate = `VAT must be ${VAT_RATES_SENTENCE}`;

  if (!EXPENSE_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  if (
    data.payment_method &&
    !PAYMENT_METHODS.includes(data.payment_method as never)
  )
    errors.payment_method = "Invalid payment method";

  return errors;
}

// A real date column will reject anything else, so catch it here first.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (value: unknown): boolean => {
  const text = String(value ?? "").trim();
  if (!ISO_DATE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
};

// Today, in the same UTC-day terms the rest of the app already uses when it
// defaults a paid date (lib/… and the Mark Paid route both do
// `toISOString().slice(0, 10)`). Deliberately shared so the client form and the
// route handler agree on where "the future" starts, rather than one of them
// rejecting a date the other had just filled in.
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

// A multi-line purchase: one document header, N lines, and 0..N payments.
//
// Errors on a nested row are keyed `lines.0.qty` / `payments.1.amount` so the
// form can put the message under the field it belongs to. Every rule here
// mirrors a CHECK constraint from migration 0008 — those reject rather than
// coerce (about.md §2 rule 4), so anything this misses becomes a 500 instead
// of a field error.
export function validatePurchase(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};

  const supplier = String(data.supplier_name ?? "").trim();
  if (supplier.length > 200) errors.supplier_name = "Max 200 characters";

  const week = data.week_no;
  if (week !== null && week !== undefined && String(week).trim() !== "") {
    const n = num(week);
    if (!Number.isInteger(n) || n < 1)
      errors.week_no = "Week must be a positive whole number";
  }

  if (data.purchase_date && !isDate(data.purchase_date))
    errors.purchase_date = "Use a real date";

  if (data.category && !EXPENSE_CATEGORIES.includes(data.category as never))
    errors.category = "Invalid category";

  if (!EXPENSE_STATUSES.includes(data.entry_status as never))
    errors.entry_status = "Invalid status";

  // Mirrors the quoted_gross >= 0 CHECK from migration 0008. Blank is valid
  // and means "nobody recorded an agreed figure" — which is what nearly every
  // row says, and what the screens hide the Committed card for.
  const quoted = String(data.quoted_gross ?? "").trim();
  if (quoted !== "") {
    const n = num(quoted);
    if (!Number.isFinite(n) || n < 0)
      errors.quoted_gross = "Must be a non-negative amount";
  }

  // Retention (migration 0019). Folded in here rather than called separately
  // by each route, so the form and the handler can never disagree about it.
  Object.assign(errors, validateRetention(data));

  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (lines.length === 0) errors.lines = "An invoice needs at least one line";

  lines.forEach((raw, i) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    const description = String(line.description_raw ?? "").trim();
    if (!description) errors[`lines.${i}.description_raw`] = "Required";
    else if (description.length > 200)
      errors[`lines.${i}.description_raw`] = "Max 200 characters";

    if (num(line.qty) < 0) errors[`lines.${i}.qty`] = "Must be non-negative";
    if (num(line.unit_price) < 0)
      errors[`lines.${i}.unit_price`] = "Must be non-negative";
    if (num(line.line_net) < 0)
      errors[`lines.${i}.line_net`] = "Must be non-negative";

    // Blank is its own error, not a zero. The invoice review screen leaves the
    // rate empty when the document printed one the database will not take —
    // saying "pick it" is the whole point of that, and `num("")` would
    // otherwise quietly turn it into 0% and lose the VAT.
    const vat = String(line.vat_rate ?? "").trim();
    if (vat === "")
      errors[`lines.${i}.vat_rate`] = "Pick the VAT rate printed on the invoice";
    else if (!isVatRate(num(vat)))
      errors[`lines.${i}.vat_rate`] = `VAT must be ${VAT_RATES_SENTENCE}`;
  });

  const payments = Array.isArray(data.payments) ? data.payments : [];
  payments.forEach((raw, i) => {
    const payment = (raw ?? {}) as Record<string, unknown>;
    const amount = num(payment.amount);
    if (amount < 0) errors[`payments.${i}.amount`] = "Must be non-negative";
    // A payment of nothing is not a payment. The form drops blank rows before
    // sending, so reaching here means a figure was cleared but the row kept.
    if (amount === 0) errors[`payments.${i}.amount`] = "Enter what was paid";
    if (payment.paid_on && !isDate(payment.paid_on))
      errors[`payments.${i}.paid_on`] = "Use a real date";
    if (payment.method && !PAYMENT_METHODS.includes(payment.method as never))
      errors[`payments.${i}.method`] = "Invalid payment method";
  });

  return errors;
}

// A day's labour, logged by hand rather than off an invoice.
//
// This is a *narrower* form than validatePurchase, not a different one: it ends
// up as one ordinary purchase with a single Labour line, so every rule below
// still mirrors the same CHECK constraints from migration 0008. It exists
// separately because the fields the user actually types (a name, a rate, hours,
// a total) are not the fields a purchase stores, and mapping one to the other
// is the route handler's job — see app/api/projects/[id]/labour/route.ts.
//
// The payment block is conditional on purpose. Only a status of Paid writes a
// payments row, so only a status of Paid has payment fields to check; the other
// three statuses must not be made to invent a date or a method they do not have.
export function validateLabourEntry(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  const name = String(data.name ?? "").trim();
  if (!name) errors.name = "Who did the work?";
  else if (name.length > 200) errors.name = "Max 200 characters";

  const trade = String(data.trade ?? "").trim();
  if (!trade) errors.trade = "Pick a trade, or add a new one";

  // Blank is an error rather than a zero for the same reason vat_rate is: an
  // unanswered field and a deliberate nil are not the same thing.
  const rate = String(data.rate ?? "").trim();
  if (rate === "") errors.rate = "Enter the hourly rate";
  else if (!Number.isFinite(Number(rate)) || Number(rate) < 0)
    errors.rate = "Must be non-negative";

  const hours = String(data.hours ?? "").trim();
  if (hours === "") errors.hours = "Enter the hours worked";
  else if (!Number.isFinite(Number(hours)) || Number(hours) <= 0)
    errors.hours = "Must be more than zero";

  const totalPay = String(data.total_pay ?? "").trim();
  if (totalPay === "") errors.total_pay = "Enter the total pay";
  else if (!Number.isFinite(Number(totalPay)) || Number(totalPay) < 0)
    errors.total_pay = "Must be non-negative";

  // Same rule as a purchase line: a blank rate is a question nobody answered,
  // and num("") would quietly turn it into 0% and lose the VAT.
  const vat = String(data.vat_rate ?? "").trim();
  if (vat === "") errors.vat_rate = "Pick the VAT rate";
  else if (!isVatRate(num(vat))) errors.vat_rate = `VAT must be ${VAT_RATES_SENTENCE}`;

  if (!EXPENSE_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  if (data.status === "Paid") {
    const paidOn = String(data.paid_on ?? "").trim();
    if (!paidOn) errors.paid_on = "When was it paid?";
    else if (!isDate(paidOn)) errors.paid_on = "Use a real date";
    else if (paidOn > todayISO()) errors.paid_on = "That date is in the future";

    if (!PAYMENT_METHODS.includes(data.payment_method as never))
      errors.payment_method = "Pick how it was paid";

    const amount = String(data.paid_amount ?? "").trim();
    if (amount === "") errors.paid_amount = "Enter what was handed over";
    else if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      errors.paid_amount = "Enter what was handed over";
  }

  return errors;
}

// ============================================================
// The schedule (migrations 0016–0018)
// ============================================================
// Every rule below mirrors a CHECK constraint in 0016. Those reject rather
// than coerce (about.md §2 rule 4), so anything missed here becomes a 500
// instead of a message under the field it belongs to.

/**
 * The working calendar (migration 0018) — which weekdays count as working days.
 *
 * Mirrors `projects_working_weekdays_valid`: between one and seven ISO weekday
 * numbers, every one of them in 1…7. An empty set is refused by the database
 * because it would mean no day is a working day, which makes every task
 * infinitely long — the forward pass would never terminate. Saying that under
 * the field beats a 500 from the CHECK.
 *
 * Duplicates are rejected here rather than silently collapsed. `{1,1,2}` is
 * somebody's mistake, and a form that accepts it and stores something else has
 * lied about what it saved.
 */
export function validateWorkCalendar(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};
  const raw = data.working_weekdays;

  if (!Array.isArray(raw)) {
    errors.working_weekdays = "Pick the days worked on this job";
    return errors;
  }

  const days = raw.map((d) => Number(d));
  if (days.length === 0)
    errors.working_weekdays = "At least one day has to be a working day";
  else if (days.length > 7)
    errors.working_weekdays = "There are only seven days in a week";
  else if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
    errors.working_weekdays = "Days are numbered 1 (Monday) to 7 (Sunday)";
  else if (new Set(days).size !== days.length)
    errors.working_weekdays = "The same day is listed twice";

  return errors;
}

/** One non-working date (migration 0018). The date is the whole of it. */
export function validateHoliday(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!isDate(data.holiday_date))
    errors.holiday_date = "Pick the day the site is shut";

  if (String(data.name ?? "").trim().length > 120)
    errors.name = "Max 120 characters";

  return errors;
}

export function validatePhase(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};

  const name = String(data.name ?? "").trim();
  if (!name) errors.name = "Give the phase a name";
  else if (name.length > 120) errors.name = "Max 120 characters";

  if (data.target_start && !isDate(data.target_start))
    errors.target_start = "Use a real date";
  if (data.target_end && !isDate(data.target_end))
    errors.target_end = "Use a real date";
  // Mirrors project_phases_dates_ordered.
  if (
    isDate(data.target_start) &&
    isDate(data.target_end) &&
    String(data.target_end) < String(data.target_start)
  )
    errors.target_end = "The end cannot be before the start";

  if (data.colour && !PHASE_COLOURS.includes(data.colour as never))
    errors.colour = "Invalid colour";

  return errors;
}

export function validateTask(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};

  const name = String(data.name ?? "").trim();
  if (!name) errors.name = "What is the work?";
  else if (name.length > 200) errors.name = "Max 200 characters";

  if (!TASK_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  for (const field of [
    "planned_start",
    "planned_end",
    "actual_start",
    "actual_end",
  ] as const) {
    if (data[field] && !isDate(data[field])) errors[field] = "Use a real date";
  }

  // Mirrors tasks_planned_dates_ordered / tasks_actual_dates_ordered.
  if (
    isDate(data.planned_start) &&
    isDate(data.planned_end) &&
    String(data.planned_end) < String(data.planned_start)
  )
    errors.planned_end = "The end cannot be before the start";
  if (
    isDate(data.actual_start) &&
    isDate(data.actual_end) &&
    String(data.actual_end) < String(data.actual_start)
  )
    errors.actual_end = "The end cannot be before the start";

  // Blank is legitimate — a task being sketched out has no duration yet — but
  // zero is not: a task that takes no days is not a task.
  const duration = String(data.duration_days ?? "").trim();
  if (duration !== "") {
    const n = Number(duration);
    if (!Number.isInteger(n) || n < 1)
      errors.duration_days = "Whole days, at least one";
  }

  const progress = Number(data.progress_pct ?? 0);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100)
    errors.progress_pct = "Between 0 and 100";

  const budget = String(data.budget_amount ?? "").trim();
  if (budget !== "" && (!Number.isFinite(Number(budget)) || Number(budget) < 0))
    errors.budget_amount = "Must be non-negative";

  const lead = String(data.lead_time_days ?? "").trim();
  if (lead !== "") {
    const n = Number(lead);
    if (!Number.isInteger(n) || n < 0) errors.lead_time_days = "Whole days";
  }

  const hire = String(data.hire_daily_rate ?? "").trim();
  if (hire !== "" && (!Number.isFinite(Number(hire)) || Number(hire) < 0))
    errors.hire_daily_rate = "Must be non-negative";

  if (data.reason_code && !REASON_CODES.includes(data.reason_code as never))
    errors.reason_code = "Invalid reason";

  return errors;
}

export function validateDependency(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  const predecessor = String(data.predecessor_id ?? "").trim();
  const successor = String(data.successor_id ?? "").trim();
  if (!predecessor) errors.predecessor_id = "Pick the task that comes first";
  if (!successor) errors.successor_id = "Pick the task that follows";
  // Mirrors task_dependencies_not_self.
  if (predecessor && predecessor === successor)
    errors.successor_id = "A task cannot depend on itself";

  if (!DEP_TYPES.includes(data.dep_type as never))
    errors.dep_type = "Invalid link type";

  // A lead is negative and perfectly ordinary — only a non-integer is wrong.
  // The unit is CALENDAR days (lib/schedule.ts rule 3): a wait is a wait
  // whether or not anybody is on site for it.
  const lag = String(data.lag_days ?? "0").trim();
  if (lag !== "" && !Number.isInteger(Number(lag)))
    errors.lag_days = "Whole calendar days (negative for a lead)";

  return errors;
}

/**
 * A date move on a task that has a baseline must say why.
 *
 * This is the single most valuable rule in the schedule half of the app and it
 * is deliberately enforced rather than encouraged: a revision log that is
 * optional gets skipped, and a log everybody skipped answers no question at
 * all six months later. Before a baseline exists there is nothing to explain,
 * so it does not apply.
 */
export function validateShiftReason(
  data: Record<string, unknown>,
  opts: { movesDates: boolean; hasBaseline: boolean }
): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!opts.movesDates || !opts.hasBaseline) return errors;
  const code = String(data.reason_code ?? "").trim();
  if (!code) errors.reason_code = "Why did this move?";
  else if (!REASON_CODES.includes(code as never))
    errors.reason_code = "Invalid reason";
  // 'other' with no note is a reason code that explains nothing.
  if (code === "other" && !String(data.reason_note ?? "").trim())
    errors.reason_note = "Say what happened";
  return errors;
}

// ============================================================
// Track B (migrations 0019–0024)
// ============================================================
// Every rule below mirrors a CHECK constraint. Those reject rather than coerce
// (about.md §2 rule 4), so anything missed here becomes a 500 instead of a
// message under the field it belongs to.

/**
 * Retention on an invoice (migration 0019).
 *
 * Called by `validatePurchase` rather than standing alone, because retention
 * is an attribute of the document and never arrives without one.
 */
export function validateRetention(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};
  const pct = String(data.retention_pct ?? "").trim();

  if (pct !== "") {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      errors.retention_pct = "Between 0 and 100";
    // A retention of nothing is not a retention. Blank is the way to say
    // "none"; typing 0 is almost always a half-finished thought.
    else if (n === 0)
      errors.retention_pct = "Leave it blank if nothing is held back";
  }

  for (const field of ["retention_release_due", "retention_released_on"] as const) {
    if (data[field] && !isDate(data[field])) errors[field] = "Use a real date";
  }

  // Mirrors purchases_retention_dates_need_pct. A release date with no
  // percentage describes nothing at all.
  if (
    pct === "" &&
    (String(data.retention_release_due ?? "").trim() !== "" ||
      String(data.retention_released_on ?? "").trim() !== "")
  )
    errors.retention_pct = "Enter the percentage held back";

  return errors;
}

/** A person in the trades register (migration 0020). */
export function validateContact(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  const name = String(data.name ?? "").trim();
  if (!name) errors.name = "Who is it?";
  else if (name.length > 200) errors.name = "Max 200 characters";

  if (String(data.company ?? "").trim().length > 200)
    errors.company = "Max 200 characters";

  // Deliberately lenient: a UK mobile, a landline with an area code in
  // brackets and an international number are all valid, and a strict pattern
  // here would reject a real number somebody needs to ring.
  const email = String(data.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "That does not look like an email address";

  for (const field of ["day_rate", "hourly_rate"] as const) {
    const value = String(data[field] ?? "").trim();
    if (value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))
      errors[field] = "Must be non-negative";
  }

  if (data.status && !CONTACT_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  return errors;
}

/** One certificate, and the date that makes it worth recording. */
export function validateCertification(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!CERTIFICATION_KINDS.includes(data.kind as never))
    errors.kind = "Pick what kind of certificate it is";

  for (const field of ["issued_on", "expires_on"] as const) {
    if (data[field] && !isDate(data[field])) errors[field] = "Use a real date";
  }
  // Mirrors contact_certifications_dates_ordered.
  if (
    isDate(data.issued_on) &&
    isDate(data.expires_on) &&
    String(data.expires_on) < String(data.issued_on)
  )
    errors.expires_on = "It cannot expire before it was issued";

  return errors;
}

/** A sign-off. Records who; enforces nothing (about.md §9.1). */
export function validateSignoff(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!SIGNOFF_OUTCOMES.includes(data.outcome as never))
    errors.outcome = "Approved, rejected, or approved with snags?";
  // A rejection with no note is a rejection nobody can act on — the whole
  // value of the record is knowing what has to change.
  if (data.outcome === "rejected" && !String(data.note ?? "").trim())
    errors.note = "Say what needs putting right";
  return errors;
}

/** A document or photo (migration 0021). */
export function validateDocument(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  const title = String(data.title ?? "").trim();
  if (!title) errors.title = "Give it a title";
  else if (title.length > 200) errors.title = "Max 200 characters";

  if (!DOC_TYPES.includes(data.doc_type as never))
    errors.doc_type = "Pick a document type";

  for (const field of ["issued_on", "expires_on", "taken_at"] as const) {
    if (data[field] && !isDate(data[field])) errors[field] = "Use a real date";
  }
  // Mirrors documents_dates_ordered.
  if (
    isDate(data.issued_on) &&
    isDate(data.expires_on) &&
    String(data.expires_on) < String(data.issued_on)
  )
    errors.expires_on = "It cannot expire before it was issued";

  // A photo with no capture date lands at the end of the timeline rather than
  // in the wrong place, which is correct but not useful — so it is prompted
  // for, not required.
  return errors;
}

/** One entry in the activity log (migration 0022). */
export function validateActivity(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!ACTIVITY_KINDS.includes(data.kind as never))
    errors.kind = "What kind of entry is it?";

  const summary = String(data.summary ?? "").trim();
  if (!summary) errors.summary = "What happened?";
  else if (summary.length > 300) errors.summary = "Max 300 characters";

  // `occurred_at` is a timestamp, and the form sends a date. A future entry in
  // a log of what has already happened is a typo every time.
  const when = String(data.occurred_at ?? "").trim();
  if (when !== "") {
    if (!isDate(when)) errors.occurred_at = "Use a real date";
    else if (when > todayISO()) errors.occurred_at = "That date is in the future";
  }

  return errors;
}

/** One snag (migration 0022). */
export function validateSnag(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};

  const title = String(data.title ?? "").trim();
  if (!title) errors.title = "What is wrong?";
  else if (title.length > 200) errors.title = "Max 200 characters";

  if (!SNAG_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";
  if (!SNAG_SEVERITIES.includes(data.severity as never))
    errors.severity = "Invalid severity";

  for (const field of ["raised_on", "fixed_on", "verified_on"] as const) {
    if (data[field] && !isDate(data[field])) errors[field] = "Use a real date";
  }
  // Mirrors snags_fix_before_verify.
  if (
    isDate(data.fixed_on) &&
    isDate(data.verified_on) &&
    String(data.verified_on) < String(data.fixed_on)
  )
    errors.verified_on = "It cannot be verified before it was fixed";

  // The status and the dates have to tell the same story. Without this a snag
  // reads "verified" with nothing saying when anybody looked at it, which is
  // precisely the claim a snagging list exists to be able to prove.
  const status = String(data.status ?? "");
  if (status === "fixed" && !isDate(data.fixed_on))
    errors.fixed_on = "When was it fixed?";
  if (status === "verified") {
    if (!isDate(data.fixed_on)) errors.fixed_on = "When was it fixed?";
    if (!isDate(data.verified_on)) errors.verified_on = "When was it checked?";
  }

  return errors;
}

/** A purchase order and its lines (migration 0023). */
export function validatePurchaseOrder(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!PO_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  if (String(data.po_number ?? "").trim().length > 100)
    errors.po_number = "Max 100 characters";

  for (const field of ["raised_on", "expected_delivery"] as const) {
    if (data[field] && !isDate(data[field])) errors[field] = "Use a real date";
  }

  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (lines.length === 0) errors.lines = "An order needs at least one line";

  lines.forEach((raw, i) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    const description = String(line.description ?? "").trim();
    if (!description) errors[`lines.${i}.description`] = "Required";
    else if (description.length > 200)
      errors[`lines.${i}.description`] = "Max 200 characters";

    for (const field of ["qty_ordered", "qty_received", "unit_price"] as const) {
      const value = String(line[field] ?? "").trim();
      if (value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))
        errors[`lines.${i}.${field}`] = "Must be non-negative";
    }

    // Same rule as an invoice line: blank is a question nobody answered, and
    // num("") would quietly turn it into 0% and lose the VAT.
    const vat = String(line.vat_rate ?? "").trim();
    if (vat === "") errors[`lines.${i}.vat_rate`] = "Pick the VAT rate";
    else if (!isVatRate(num(vat)))
      errors[`lines.${i}.vat_rate`] = `VAT must be ${VAT_RATES_SENTENCE}`;
  });

  // Over-delivery is a real thing that happens and is reported, not refused —
  // see lib/purchaseOrders.ts. Nothing here rejects qty_received > qty_ordered.
  return errors;
}

/** A change order (migration 0024). */
export function validateVariation(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  const title = String(data.title ?? "").trim();
  if (!title) errors.title = "What changed?";
  else if (title.length > 200) errors.title = "Max 200 characters";

  if (!VARIATION_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  for (const field of ["raised_on", "approved_on"] as const) {
    if (data[field] && !isDate(data[field])) errors[field] = "Use a real date";
  }

  // Mirrors variations_approved_needs_status. An approval date on something
  // that is not approved is the kind of contradiction that makes a report
  // silently wrong rather than error.
  if (data.approved_on && String(data.status) !== "approved")
    errors.approved_on = "Only an approved variation has an approval date";
  if (String(data.status) === "approved" && !isDate(data.approved_on))
    errors.approved_on = "When was it approved?";

  // Both impacts are SIGNED — a variation can be an omission — so only a
  // non-number is wrong here, never a negative one.
  const cost = String(data.cost_impact ?? "").trim();
  if (cost !== "" && !Number.isFinite(Number(cost)))
    errors.cost_impact = "Enter an amount (negative for an omission)";

  const days = String(data.days_impact ?? "").trim();
  if (days !== "" && !Number.isInteger(Number(days)))
    errors.days_impact = "Whole days (negative to pull the job forward)";

  return errors;
}

export function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
