/**
 * Domain core. Every pure decision the tool makes lives here: plain data in,
 * plain data out. No filesystem, no network, no React, and no clock unless a
 * `today` value is passed in.
 *
 * The store keeps the atomic JSON write and dossier sync; the UI, CLI and API
 * stay thin pass-throughs. That makes the behaviour testable and lets later
 * architecture work move code without changing what anyone sees.
 *
 * v0 vocabulary is frozen here on purpose: a "lead" is a company row with its
 * outreach merged in, and `outreach.stage` is called Stage. ADR-0001 separates
 * Company from Lead and calls a Lead's position Status; those renames belong
 * to the v1 tickets, not to this behaviour-preserving seam.
 */

export const STAGES = [
  "sourced",
  "drafted",
  "sent",
  "replied",
  "call",
  "trial",
  "offer",
  "declined",
  "revisit",
  "ghosted",
];

export const CHANNELS = ["x", "linkedin", "email", "other"];

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function domainOf(website) {
  if (!website) return "";
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

/** The record that owns a domain, if any. Dedupe hinges on this lookup. */
export function findByDomain(companies = {}, domain) {
  if (!domain) return null;
  return Object.values(companies).find((c) => domainOf(c.website) === domain) || null;
}

/**
 * The slug an incoming company should land on. When its domain already belongs
 * to a record, that record wins, so a second source merges rather than
 * duplicating; otherwise an explicit slug, else one derived from the name.
 */
export function slugForCompany(companies = {}, input = {}) {
  const existing = findByDomain(companies, domainOf(input.website));
  return existing?.slug || input.slug || slugify(input.name);
}

/**
 * List with the outreach row merged in. Filters are intentionally simple; the
 * dataset is small enough that filtering in memory is honest.
 */
export function selectLeads({ companies = {}, outreach = {} } = {}, { stage, q, hasRoles, source, limit } = {}) {
  let rows = Object.keys(companies).map((slug) => ({
    ...companies[slug],
    outreach: outreach[slug] || { stage: "sourced" },
  }));

  if (stage) rows = rows.filter((r) => r.outreach.stage === stage);
  if (source) rows = rows.filter((r) => (r.sources || []).some((s) => s.source === source));
  if (hasRoles) rows = rows.filter((r) => (r.hiring?.roles?.length || 0) > 0);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) =>
      [r.name, r.location, r.batch, r.website].filter(Boolean).join(" ").toLowerCase().includes(needle),
    );
  }

  rows.sort((a, b) => {
    const byBatch = (b.batchYear || 0) - (a.batchYear || 0);
    if (byBatch) return byBatch;
    return a.name.localeCompare(b.name);
  });

  return typeof limit === "number" ? rows.slice(0, limit) : rows;
}
