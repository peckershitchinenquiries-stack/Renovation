// Sender-domain rules, shared by the gate and the triage write path.
//
// These lived inside app/api/gmail/drain/route.ts, where only the *reader* of
// supplier_domains could see them. Now that /api/invoices/[id]/triage also
// *writes* that table, the two have to agree exactly: if triage stored
// "Selco.co.uk " and the gate normalised to "selco.co.uk", trusting a sender
// would appear to work and the very next invoice from them would land in
// triage again. One copy, imported by both.

/**
 * The TypeScript mirror of the database's `public.norm_key` — the same rule
 * the supplier and item alias matchers use (about.md §9), and the rule the
 * unique index `ux_supplier_domains_user_domain` is built on.
 */
export function normKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** `"Selco <sales@selco.co.uk>"` → `"sales@selco.co.uk"`. */
export function parseFromAddress(header: string | null): string | null {
  if (!header) return null;
  const angled = header.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : header).trim();
  return candidate.includes("@") ? candidate : null;
}

/**
 * The domain part of a sender, normalised.
 *
 * Tolerates being handed a whole `From:` header rather than a bare address,
 * because `invoice_uploads.from_address` stores `fromAddress ?? fromHeader` —
 * i.e. it falls back to the raw header when the address could not be parsed.
 */
export function domainOf(address: string | null): string | null {
  if (!address) return null;
  const bare = parseFromAddress(address) ?? address;
  const at = bare.lastIndexOf("@");
  if (at < 0) return null;
  const domain = normKey(bare.slice(at + 1).replace(/[>\s]+$/, ""));
  return domain || null;
}

/**
 * Is this sender a declared supplier?
 *
 * Sub-domains count: a supplier whose invoices come from
 * `billing.mail.selco.co.uk` is still Selco, and making the owner declare every
 * sending sub-domain would mean invoices silently landing in triage until they
 * noticed. The match requires a `.` boundary, so `notselco.co.uk` does not
 * match `selco.co.uk` — and a declared `selco.co.uk` can never be satisfied by
 * something merely *containing* it.
 */
export function domainIsDeclared(domain: string, declared: string[]): boolean {
  return declared.some((d) => domain === d || domain.endsWith(`.${d}`));
}
