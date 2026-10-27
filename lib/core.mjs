/**
 * Domain core. Every pure decision the tool makes lives here: plain data in,
 * plain data out. No filesystem, no network, no React, and no clock unless a
 * `today` value is passed in.
 *
 * The store keeps the atomic JSON write and dossier sync; the UI, CLI and API
 * stay thin pass-throughs. That makes the behaviour testable and lets later
 * architecture work move code without changing what anyone sees.
 *
 * v1 vocabulary, per ADR-0001: a Company is public facts plus a research state,
 * a Person is a named human at one Company, and a Lead is one Person you would
 * write to. Two people at one Company are two Leads with independent statuses.
 */

export const DB_VERSION = 2;

/** Where a Company stands in your research, not where a person stands with you. */
export const RESEARCH_STATUSES = ["untriaged", "researched", "parked"];

/** Where a Lead stands with you. Only a human moves a Lead. */
export const LEAD_STATUSES = [
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

/** One Attempt is a recorded event: a day, a channel, a kind and an optional line. */
export const ATTEMPT_CHANNELS = ["email", "linkedin", "x", "other"];
export const ATTEMPT_KINDS = ["first", "followup"];

/**
 * The ladder: after an unanswered Attempt wait this many days. After the cap,
 * suggest ghosted and set no date. Constants, not configuration, per the spec.
 */
export const LADDER_DAYS = [4, 7];
export const ATTEMPT_CAP = 3;

/** A ladder only runs while nothing has come back: replied and past it are done. */
const LADDER_STATUSES = ["sourced", "drafted", "sent"];

/** Leads whose conversation is live: named and beyond the backlog, not yet settled. */
export const LEAD_IN_FLIGHT_STATUSES = ["drafted", "sent", "replied", "call", "trial"];

/**
 * Company research is a loop, not a pipeline: any state can be reached from any
 * other, including back to untriaged when a parked company becomes interesting.
 */
const RESEARCH_TRANSITIONS = {
  untriaged: ["researched", "parked"],
  researched: ["untriaged", "parked"],
  parked: ["untriaged", "researched"],
};

/**
 * Lead status is a pipeline with timed side exits. Jumps that skip the work are
 * refused: the point of the guard is that `offer` cannot be reached from
 * `sourced` by a slip of a select box.
 *
 * - `declined` is terminal; `offer` is the success end, but an offer can still
 *   be turned down or time out, so it keeps the same side exits.
 * - `ghosted` can return to `replied`: people do come back.
 * - `revisit` is "not now", so it can rejoin at drafted or sent.
 */
const LEAD_TRANSITIONS = {
  sourced: ["drafted", "declined", "ghosted", "revisit"],
  drafted: ["sent", "declined", "ghosted", "revisit"],
  sent: ["replied", "declined", "ghosted", "revisit"],
  replied: ["call", "declined", "ghosted", "revisit"],
  call: ["trial", "declined", "ghosted", "revisit"],
  trial: ["offer", "declined", "ghosted", "revisit"],
  offer: ["declined", "revisit", "ghosted"],
  declined: [],
  ghosted: ["replied", "revisit", "declined"],
  revisit: ["drafted", "sent", "declined", "ghosted"],
};

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

const LEAD_ID_SEPARATOR = "--";

/**
 * The id of the Lead for one person at one Company: `<companySlug>--<personSlug>`.
 * A person lives under exactly one Company, so the id stays legible, and because
 * a company slug can never contain `--`, the two halves split unambiguously.
 *
 * Identity is assigned once, when the person is first named. A rename edits the
 * person and leaves the id alone; a repeated name takes the next free `-2`, `-3`.
 * `takenLeadIds` is the set of ids already in use, so the answer is deterministic.
 */
export function leadIdFor(companySlug, personName, takenLeadIds = []) {
  const company = slugify(companySlug);
  const person = slugify(personName);
  if (!company || !person) return "";

  const taken = new Set(takenLeadIds);
  const base = `${company}${LEAD_ID_SEPARATOR}${person}`;
  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** The Company half of a Lead id. The only place that knows the separator. */
export function companySlugOf(leadId) {
  const id = String(leadId || "");
  const at = id.indexOf(LEAD_ID_SEPARATOR);
  return at === -1 ? id : id.slice(0, at);
}

export function legalResearchTransitions(status) {
  return RESEARCH_TRANSITIONS[status] ? [...RESEARCH_TRANSITIONS[status]] : [];
}

/** Research queue order: untriaged first, parked last. */
export function researchRank(status) {
  const at = RESEARCH_STATUSES.indexOf(status || "untriaged");
  return at === -1 ? RESEARCH_STATUSES.length : at;
}

/**
 * Move a Company's research state, or refuse and name where it could go instead.
 * A state moved to itself is a no-op, so resubmitting a form is harmless.
 */
export function assertResearchTransition(from, to) {
  if (!RESEARCH_STATUSES.includes(from)) {
    throw new Error(`unknown research status: ${from} (known: ${RESEARCH_STATUSES.join(", ")})`);
  }
  if (!RESEARCH_STATUSES.includes(to)) {
    throw new Error(`unknown research status: ${to} (known: ${RESEARCH_STATUSES.join(", ")})`);
  }
  if (from === to) return to;

  const legal = legalResearchTransitions(from);
  if (!legal.includes(to)) {
    throw new Error(
      `illegal research transition: ${from} → ${to} (legal from ${from}: ${legal.join(", ")})`,
    );
  }
  return to;
}

export function legalLeadTransitions(status) {
  return LEAD_TRANSITIONS[status] ? [...LEAD_TRANSITIONS[status]] : [];
}

/**
 * Move a Lead's status, or refuse and name the legal set. A status moved to
 * itself is a no-op, so resubmitting a form is harmless.
 */
export function assertLeadTransition(from, to) {
  if (!LEAD_STATUSES.includes(from)) {
    throw new Error(`unknown lead status: ${from} (known: ${LEAD_STATUSES.join(", ")})`);
  }
  if (!LEAD_STATUSES.includes(to)) {
    throw new Error(`unknown lead status: ${to} (known: ${LEAD_STATUSES.join(", ")})`);
  }
  if (from === to) return to;

  const legal = legalLeadTransitions(from);
  if (!legal.includes(to)) {
    const named = legal.length ? legal.join(", ") : "none — terminal";
    throw new Error(`illegal lead status transition: ${from} → ${to} (legal from ${from}: ${named})`);
  }
  return to;
}

/** A calendar day, `YYYY-MM-DD`, with no time or zone attached. */
export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

/** Day arithmetic in UTC so a date never drifts across a zone boundary. */
export function addDays(date, days) {
  if (!isIsoDate(date)) throw new Error(`not a date: ${date} (expected YYYY-MM-DD)`);
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day) + Number(days) * 86400000);
  return at.toISOString().slice(0, 10);
}

/**
 * The operator's local calendar day, not UTC. The caller passes the clock, so
 * the core stays free of one.
 */
export function isoDay(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * One recorded try at reaching a Lead. The note is optional, one line, and is
 * what a follow-up brief later quotes back, so it is worth the seconds it costs.
 */
export function createAttempt(input = {}, { today } = {}) {
  const channel = String(input.channel || "").trim();
  if (!ATTEMPT_CHANNELS.includes(channel)) {
    throw new Error(`unknown attempt channel: ${channel || "(none)"} (known: ${ATTEMPT_CHANNELS.join(", ")})`);
  }

  const kind = String(input.kind || "").trim();
  if (!ATTEMPT_KINDS.includes(kind)) {
    throw new Error(`unknown attempt kind: ${kind || "(none)"} (known: ${ATTEMPT_KINDS.join(", ")})`);
  }

  const date = String(input.date || today || "");
  if (!isIsoDate(date)) throw new Error(`attempt date must be YYYY-MM-DD, got: ${date || "(none)"}`);
  if (today && date > today) {
    throw new Error(`attempt date cannot be in the future: ${date} (today is ${today})`);
  }

  const note = String(input.note || "")
    .replace(/\s+/g, " ")
    .trim();

  return { date, channel, kind, ...(note ? { note } : {}) };
}

/** The corpus order: oldest first, same-day Attempts in the order logged. */
export function sortAttempts(attempts = []) {
  return attempts
    .map((value, index) => ({ value, index }))
    .sort((a, b) => String(a.value.date || "").localeCompare(String(b.value.date || "")) || a.index - b.index)
    .map(({ value }) => value);
}

/** What the Lead page and the dossier show: most recent first. */
export function attemptsNewestFirst(attempts = []) {
  return sortAttempts(attempts).reverse();
}

/**
 * What the ladder proposes next. A suggestion, never an application: the
 * operator confirms it or overrides the date per Lead.
 *
 * The first Attempt waits 4 days, the second 7, and a third unanswered Attempt
 * suggests `ghosted` with no next date. A reply, or any status past `sent`,
 * stops the ladder and leaves the date to the operator.
 */
export function ladderSuggestion({ status = "sourced", attempts = [] } = {}) {
  const sorted = sortAttempts(attempts);
  const count = sorted.length;

  if (!LADDER_STATUSES.includes(status)) {
    return { stopped: true, count, status: null, nextTouch: null, days: null };
  }
  if (count === 0) {
    return { stopped: false, count, status: null, nextTouch: null, days: null };
  }
  if (count >= ATTEMPT_CAP) {
    return { stopped: false, count, status: "ghosted", nextTouch: null, days: null };
  }

  const days = LADDER_DAYS[count - 1];
  return { stopped: false, count, status: null, nextTouch: addDays(sorted[count - 1].date, days), days };
}

/**
 * The Lead after a status move, with the dates that move implies: a reply clears
 * the suggested next touch, ghosting or declining clears it too, `revisit`
 * needs a date and drops the touch date, and leaving `revisit` clears its date.
 *
 * `revisit` is the one state that cannot exist without a date: "not now" is
 * timed, or it is lost.
 */
export function applyLeadTransition(lead = {}, to, { revisitAfter } = {}) {
  const status = assertLeadTransition(lead.status, to);
  const next = { ...lead, status };

  if (status === "revisit") {
    const date = revisitAfter || (lead.status === "revisit" ? lead.revisitAfter : null);
    if (!date) {
      throw new Error("a revisit needs a date (revisitAfter: YYYY-MM-DD), so the Lead comes back on its own");
    }
    if (!isIsoDate(date)) throw new Error(`revisit date must be YYYY-MM-DD, got: ${date}`);
    next.revisitAfter = date;
    next.nextTouch = null;
    next.nextTouchOverride = false;
    return next;
  }

  next.revisitAfter = null;

  if (status === "replied" || status === "ghosted" || status === "declined") {
    next.nextTouch = null;
    next.nextTouchOverride = false;
  }

  return next;
}

/** The next Attempt's kind follows the history: the first one opens, the rest follow up. */
export function defaultAttemptKind(attempts = []) {
  return attempts.length ? "followup" : "first";
}

/**
 * The whole effect of logging one Attempt, as data: the recorded event, the
 * history in corpus order, the ladder's suggestion, and the date the Lead would
 * carry if the suggestion is accepted.
 *
 * An overridden date survives every later Attempt, because the operator's
 * "after the 15th" beats a rule. A Lead stored before this flag existed keeps
 * its date too: an undated provenance is no reason to overwrite a plan.
 */
export function planAttempt(lead = {}, input = {}, { today, accept = false } = {}) {
  const attempt = createAttempt(input, { today });
  const attempts = sortAttempts([...(lead.attempts || []), attempt]);
  const suggestion = ladderSuggestion({ status: lead.status, attempts });
  const overridden =
    lead.nextTouchOverride == null ? Boolean(lead.nextTouch) : Boolean(lead.nextTouchOverride);
  const applies = Boolean(accept) && !overridden && !suggestion.stopped;

  return {
    attempt,
    attempts,
    suggestion,
    accepted: applies,
    nextTouch: applies ? suggestion.nextTouch : lead.nextTouch ?? null,
    nextTouchOverride: applies ? false : overridden,
  };
}

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Migrate a stored corpus to the current schema, purely. Returns `{ db, migrated }`
 * so the store knows whether it owes a write; a file already at the current
 * version comes back untouched and `migrated: false`.
 *
 * v0 stored one `outreach` row per company, which cannot express two people at
 * one company. It is discarded rather than reinterpreted: every entry in the
 * wild was empty, and carrying one forward would create a Lead with no person.
 * The inline `people` array on a v0 company is also dropped for the same reason;
 * people now have identity, so a named human must be entered deliberately.
 */
export function migrateDb(raw) {
  const input = isObject(raw) ? raw : {};
  const version = Number(input.version) || 1;
  if (version >= DB_VERSION) return { db: input, migrated: false };

  const companies = {};
  for (const [key, value] of Object.entries(isObject(input.companies) ? input.companies : {})) {
    const company = isObject(value) ? value : {};
    const { people, outreach, ...facts } = company;
    companies[key] = {
      ...facts,
      // The map key was always the canonical identity: every v0 lookup used it.
      slug: key,
      researchStatus: RESEARCH_STATUSES.includes(company.researchStatus)
        ? company.researchStatus
        : "untriaged",
    };
  }

  return {
    db: {
      version: DB_VERSION,
      updatedAt: input.updatedAt ?? null,
      companies,
      people: isObject(input.people) ? input.people : {},
      leads: isObject(input.leads) ? input.leads : {},
    },
    migrated: true,
  };
}

/**
 * One line describing how to reach a person, or an empty string. Shared by the
 * dossier and the page so the two can never drift, and it never dresses an
 * unverified address up as confirmed.
 */
export function contactSummary(person = {}) {
  const bits = [];
  if (person.handle) bits.push(person.handle);
  if (person.email) bits.push(`${person.email}${person.emailVerified ? " (verified)" : " (unverified)"}`);
  if (person.contactSource) bits.push(`source: ${person.contactSource}`);
  return bits.join(" · ");
}

/**
 * List Leads with the person and the company joined on, filtered and sorted.
 * Filters are intentionally simple; the corpus is small enough that filtering in
 * memory is honest. Search covers the four fields a person actually remembers:
 * who they are, where they work, where that is, and when it was funded.
 */
export function selectLeads({ companies = {}, people = {}, leads = {} } = {}, { status, q, hasRoles, source, limit } = {}) {
  let rows = Object.values(leads).map((lead) => ({
    ...lead,
    company: companies[lead.companySlug] || { slug: lead.companySlug, name: "" },
    person: people[lead.personId] || { personId: lead.personId, name: "" },
  }));

  if (status) rows = rows.filter((r) => r.status === status);
  if (source) rows = rows.filter((r) => (r.company.sources || []).some((s) => s.source === source));
  if (hasRoles) rows = rows.filter((r) => (r.company.hiring?.roles?.length || 0) > 0);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) =>
      [r.person.name, r.company.name, r.company.location, r.company.batch]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }

  rows.sort((a, b) => {
    const byBatch = (b.company.batchYear || 0) - (a.company.batchYear || 0);
    if (byBatch) return byBatch;
    const byCompany = (a.company.name || "").localeCompare(b.company.name || "");
    if (byCompany) return byCompany;
    return (a.person.name || "").localeCompare(b.person.name || "");
  });

  return typeof limit === "number" ? rows.slice(0, limit) : rows;
}
