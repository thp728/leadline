import fs from "node:fs";
import path from "node:path";

import {
  DB_VERSION,
  RESEARCH_STATUSES,
  LEAD_STATUSES,
  LEAD_IN_FLIGHT_STATUSES,
  slugify,
  domainOf,
  slugForCompany,
  leadIdFor,
  applyLeadTransition,
  assertResearchTransition,
  isIsoDate,
  isoDay,
  planAttempt,
  defaultAttemptKind,
  attemptsNewestFirst,
  migrateDb,
  selectLeads,
  contactSummary,
  morningBuckets,
} from "./core.mjs";

export { RESEARCH_STATUSES, LEAD_STATUSES, LEAD_IN_FLIGHT_STATUSES, slugify, domainOf };

/**
 * JSON store. Deliberately boring: one file, atomic writes, no native modules,
 * no database server. At a few hundred leads this is faster to work with than
 * SQL and every change is diffable.
 *
 * Domain decisions (identity, transitions, filtering) live in ./core.mjs; this
 * module owns the file I/O, the one-time schema migration, the write timestamps
 * and the derived dossier. Everything personal lives under data/ and is
 * gitignored.
 */

function root() {
  return process.env.LEADLINE_DATA || path.join(process.cwd(), "data");
}

function dbPath() {
  return path.join(root(), "db.json");
}

function dossierDir() {
  return path.join(root(), "dossiers");
}

export function now() {
  return new Date().toISOString();
}

export function dataRoot() {
  return root();
}

function emptyDb() {
  return { version: DB_VERSION, updatedAt: null, companies: {}, people: {}, leads: {} };
}

function readDb() {
  const file = dbPath();
  if (!fs.existsSync(file)) return emptyDb();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`db.json is not readable (${err.message}). Fix or remove ${file}.`);
  }
}

/**
 * Read the corpus, migrating a v0 file on the way through. The migration writes
 * back exactly once: a second load sees version 2 and changes nothing. Dossiers
 * are regenerated as part of that single write, so the offline copy is never a
 * schema behind.
 */
export function loadDb() {
  const { db, migrated } = migrateDb(readDb());
  if (!migrated) return db;

  saveDb(db);
  for (const slug of Object.keys(db.companies)) writeDossier(slug, db);
  return db;
}

function saveDb(db) {
  fs.mkdirSync(root(), { recursive: true });
  db.updatedAt = now();
  const file = dbPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

/** The Lead a write targets, or a refusal that names the id. */
function leadIn(db, leadId) {
  const lead = db.leads[leadId];
  if (!lead) throw new Error(`unknown lead: ${leadId}`);
  return lead;
}

/** One write path for a Lead: persist the corpus, then refresh its dossier. */
function commitLead(db, lead) {
  db.leads[lead.leadId] = lead;
  saveDb(db);
  writeDossier(lead.companySlug, db);
  return lead;
}

function mergeSources(prev = [], incoming = []) {
  const byKey = new Map(prev.map((s) => [`${s.source}|${s.url}`, s]));
  for (const s of incoming) {
    const key = `${s.source}|${s.url}`;
    byKey.set(key, { ...(byKey.get(key) || {}), ...s, fetchedAt: s.fetchedAt || now() });
  }
  return [...byKey.values()];
}

/** A person's contact detail is a fact like any other: it needs a source and a date. */
function provenanceFor(url, fetchedAt) {
  return url ? [{ source: "manual", url, fetchedAt }] : [];
}

/**
 * Insert or merge a company. Dedupes by domain when one is known, so "Acme"
 * from YC and "acme.example" from an ATS probe land on the same record. A new
 * company starts `untriaged`; an existing one keeps its research state.
 */
export function upsertCompany(input) {
  const db = loadDb();
  const slug = slugForCompany(db.companies, input);
  const prev = db.companies[slug] || {};
  const ts = now();
  const { people, outreach, ...facts } = input;

  const next = {
    researchStatus: "untriaged",
    ...prev,
    ...facts,
    slug,
    createdAt: prev.createdAt || ts,
    updatedAt: ts,
    sources: mergeSources(prev.sources, facts.sources),
  };

  db.companies[slug] = next;
  saveDb(db);
  writeDossier(slug, db);
  return next;
}

/** One Company with its People and their Leads joined on. */
export function getCompany(slug) {
  const db = loadDb();
  const company = db.companies[slug];
  if (!company) return null;

  const people = Object.values(db.people)
    .filter((p) => p.companySlug === slug)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || a.name.localeCompare(b.name));
  const leads = Object.values(db.leads)
    .filter((l) => l.companySlug === slug)
    .map((l) => ({ ...l, person: db.people[l.personId] || null }))
    .sort((a, b) => (a.person?.name || "").localeCompare(b.person?.name || ""));

  return { company, people, leads };
}

/** One Lead with its person and company joined on, for the Lead page and the API. */
export function getLead(leadId) {
  const db = loadDb();
  const lead = db.leads[leadId];
  if (!lead) return null;
  return {
    lead,
    person: db.people[lead.personId] || null,
    company: db.companies[lead.companySlug] || null,
  };
}

/**
 * Name a human at a Company. That act is what creates a Lead: status `sourced`,
 * no attempts, no pitch yet. Identity is assigned here and never again, so a
 * later rename edits the person and leaves the Lead id intact. A repeated name
 * takes the next free suffix instead of colliding. `personId` is the same string
 * as `leadId`: a person lives under exactly one Company, so one identity serves
 * both records.
 *
 * An email is stored with `emailVerified: false`; only a human confirmation
 * (`verifiedAt`, supplied deliberately) may flip it. A contact detail keeps its
 * source and fetch date, because an undated fact is a rumour.
 */
export function addPerson(companySlug, input = {}) {
  const db = loadDb();
  const company = db.companies[companySlug];
  if (!company) throw new Error(`unknown company: ${companySlug}`);

  const name = String(input.name || "").trim();
  if (!name) throw new Error("a person needs a name");

  const personId = leadIdFor(companySlug, name, Object.keys(db.leads));
  if (!personId) throw new Error("a person needs a name");

  const ts = now();
  const email = input.email || null;
  const verifiedAt = input.verifiedAt || null;

  const person = {
    personId,
    companySlug,
    name,
    role: input.role || null,
    handle: input.handle || null,
    email,
    emailVerified: Boolean(email && verifiedAt),
    contactSource: input.contactSource || input.source || null,
    sources: provenanceFor(input.contactSource || input.source, ts),
    verifiedAt: email && verifiedAt ? verifiedAt : null,
    createdAt: ts,
  };

  const lead = {
    leadId: personId,
    companySlug: person.companySlug,
    personId,
    status: "sourced",
    pitch: "",
    ask: "conversation",
    attempts: [],
    nextTouch: null,
    nextTouchOverride: false,
    revisitAfter: null,
    proofLink: null,
    notes: "",
    createdAt: ts,
    updatedAt: ts,
  };

  db.people[personId] = person;
  db.leads[personId] = lead;
  saveDb(db);
  writeDossier(person.companySlug, db);
  return { person, lead };
}

/**
 * Edit a person. Identity is immutable: personId and companySlug stay whatever
 * they were, so the Lead that owns them keeps its id across a rename. Changing
 * the email drops a previous verification, because the old check was about the
 * old address; changing the source re-stamps its provenance.
 */
export function updatePerson(personId, patch = {}) {
  const db = loadDb();
  const prev = db.people[personId];
  if (!prev) throw new Error(`unknown person: ${personId}`);

  const next = { ...prev };
  for (const key of ["name", "role", "handle", "email", "contactSource"]) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (typeof next.name === "string") next.name = next.name.trim();
  if (!next.name) throw new Error("a person needs a name");

  if (patch.verifiedAt !== undefined) {
    next.verifiedAt = patch.verifiedAt || null;
    next.emailVerified = Boolean(next.email && patch.verifiedAt);
  } else if (patch.email !== undefined && patch.email !== prev.email) {
    next.verifiedAt = null;
    next.emailVerified = false;
  }

  if (patch.contactSource !== undefined && patch.contactSource !== prev.contactSource) {
    next.sources = provenanceFor(next.contactSource, now());
  }

  db.people[personId] = next;
  saveDb(db);
  writeDossier(next.companySlug, db);
  return next;
}

/**
 * Move a Lead's status through the guarded machine, then refresh its dossier.
 * The date rules travel with the move: a reply clears the suggested next touch,
 * `revisit` refuses to exist without a date, and leaving it clears that date.
 */
export function setLeadStatus(leadId, status, { revisitAfter } = {}) {
  const db = loadDb();
  const lead = leadIn(db, leadId);

  const next = applyLeadTransition(lead, status, { revisitAfter });
  const unchanged =
    next.status === lead.status &&
    next.revisitAfter === lead.revisitAfter &&
    next.nextTouch === lead.nextTouch &&
    Boolean(next.nextTouchOverride) === Boolean(lead.nextTouchOverride);
  if (unchanged) return lead;

  next.updatedAt = now();
  return commitLead(db, next);
}

/**
 * Log one Attempt and offer the ladder's next suggestion. The suggestion is
 * data: it is applied only when the caller accepts it, and it never touches a
 * date the operator overrode by hand (`nextTouchOverride`).
 *
 * `ghost` confirms the ghosted suggestion; without it, a Lead with three
 * unanswered Attempts keeps its status and the page shows the proposal.
 */
export function logAttempt(leadId, input = {}) {
  const db = loadDb();
  const lead = leadIn(db, leadId);

  const plan = planAttempt(
    lead,
    {
      date: input.date,
      channel: input.channel,
      kind: input.kind || defaultAttemptKind(lead.attempts || []),
      note: input.note,
    },
    { today: input.today || isoDay(new Date()), accept: Boolean(input.accept) },
  );

  let next = {
    ...lead,
    attempts: plan.attempts,
    nextTouch: plan.nextTouch,
    nextTouchOverride: plan.nextTouchOverride,
    updatedAt: now(),
  };
  if (input.ghost && plan.suggestion.status === "ghosted") {
    next = applyLeadTransition(next, "ghosted");
  }

  return { attempt: plan.attempt, suggestion: plan.suggestion, lead: commitLead(db, next) };
}

/**
 * Override the next touch for one Lead, or hand it back to the ladder with an
 * empty date. An overridden date beats every later Attempt until cleared.
 */
export function setNextTouch(leadId, date) {
  const db = loadDb();
  const lead = leadIn(db, leadId);
  if (date && !isIsoDate(date)) throw new Error(`next touch must be YYYY-MM-DD, got: ${date}`);

  const next = {
    ...lead,
    nextTouch: date || null,
    nextTouchOverride: Boolean(date),
    updatedAt: now(),
  };

  return commitLead(db, next);
}

/** Move a Company's research state through the guarded machine. */
export function setResearchStatus(companySlug, status) {
  const db = loadDb();
  const company = db.companies[companySlug];
  if (!company) throw new Error(`unknown company: ${companySlug}`);

  const current = company.researchStatus || "untriaged";
  assertResearchTransition(current, status);
  if (current === status) return company;

  company.researchStatus = status;
  company.updatedAt = now();
  saveDb(db);
  writeDossier(companySlug, db);
  return company;
}

/**
 * List Leads with their person and company. The filters and the sort order live
 * in the domain core so the same rows can be proven without touching the disk.
 */
export function listLeads(filters = {}) {
  const db = loadDb();
  return selectLeads({ companies: db.companies, people: db.people, leads: db.leads }, filters);
}

/**
 * The morning screen's four buckets, computed against the operator's local day.
 * The classification lives in the domain core; this only reads the corpus.
 */
export function morning(today) {
  const db = loadDb();
  return morningBuckets({ companies: db.companies, people: db.people, leads: db.leads }, { today });
}

export function stats() {
  const db = loadDb();
  const leads = Object.values(db.leads);
  const companies = Object.values(db.companies);

  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const lead of leads) byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;

  const byResearch = Object.fromEntries(RESEARCH_STATUSES.map((s) => [s, 0]));
  for (const company of companies) {
    const state = company.researchStatus || "untriaged";
    byResearch[state] = (byResearch[state] || 0) + 1;
  }

  const companiesWithLeads = new Set(leads.map((l) => l.companySlug));
  return {
    leads: leads.length,
    companies: companies.length,
    byStatus,
    byResearch,
    needsHuman: Object.keys(db.companies).filter((slug) => !companiesWithLeads.has(slug)).length,
    withRoles: companies.filter((c) => (c.hiring?.roles?.length || 0) > 0).length,
    updatedAt: db.updatedAt,
  };
}

function bullet(label, value) {
  return value ? `- **${label}:** ${value}` : null;
}

function leadLines(lead, person) {
  const status = `- **${person.name}**${person.role ? `, ${person.role}` : ""} — \`${lead.leadId}\` — ${lead.status}`;
  const attempts = attemptsNewestFirst(lead.attempts || []);
  const details = [
    bullet("Contact", contactSummary(person)),
    bullet("Next touch", lead.nextTouch ? `${lead.nextTouch}${lead.nextTouchOverride ? " (overridden)" : ""}` : null),
    bullet("Revisit after", lead.revisitAfter),
    bullet("Ask", lead.ask && lead.ask !== "conversation" ? lead.ask : null),
    bullet("Proof link", lead.proofLink),
    bullet("Pitch", lead.pitch),
    bullet("Notes", lead.notes),
  ].filter(Boolean);

  const lines = [status, ...details.map((d) => `  ${d}`)];
  if (attempts.length) {
    lines.push(`  - Attempts (${attempts.length}, newest first):`);
    for (const a of attempts) {
      lines.push(`    - ${a.date} · ${a.channel} · ${a.kind}${a.note ? ` — ${a.note}` : ""}`);
    }
  }
  return lines;
}

/** Human- and agent-readable dossier. Regenerated on every write. */
export function writeDossier(slug, db = loadDb()) {
  const c = db.companies[slug];
  if (!c) return null;

  const leads = Object.values(db.leads)
    .filter((l) => l.companySlug === slug)
    .sort((a, b) => (a.personId || "").localeCompare(b.personId || ""));

  const lines = [
    `# ${c.name}`,
    "",
    bullet("Website", c.website),
    bullet("Batch", c.batch),
    bullet("Headcount", c.teamSize),
    bullet("Stage", c.stage),
    bullet("Location", c.location),
    bullet("Domain", domainOf(c.website)),
    bullet("Research", c.researchStatus || "untriaged"),
    "",
    "## Hiring signal",
    c.hiring
      ? [
          `- **ATS:** ${c.hiring.ats}${c.hiring.boardId ? ` (\`${c.hiring.boardId}\`)` : ""}`,
          `- **Open roles:** ${c.hiring.roles?.length ?? 0}`,
          `- **Checked:** ${c.hiring.fetchedAt}`,
          "",
          ...(c.hiring.roles || []).slice(0, 12).map(
            (r) => `  - ${r.title}${r.location ? ` — ${r.location}` : ""}${r.url ? ` ([link](${r.url}))` : ""}`,
          ),
          "",
        ].join("\n")
      : "_No public job board detected. This is the no-posting case: the pitch has to carry the role hypothesis._",
    "",
    "## Leads",
    leads.length
      ? leads
          .flatMap((l, i) => [
            ...leadLines(l, db.people[l.personId] || { name: "(unknown person)" }),
            ...(i < leads.length - 1 ? [""] : []),
          ])
          .join("\n")
      : "_No named human yet. This Company is a research task, not a Lead: name the person who owns the area, then the Lead exists._",
    "",
    "## Notes",
    c.notes || "_None._",
    "",
    "## Provenance",
    ...(c.sources || []).map((s) => `- ${s.source}: ${s.url} (fetched ${s.fetchedAt})`),
    "",
  ];

  const text = lines.filter((l) => l !== null).join("\n");
  fs.mkdirSync(dossierDir(), { recursive: true });
  fs.writeFileSync(path.join(dossierDir(), `${slug}.md`), text);
  return text;
}

export function writeAllDossiers() {
  const db = loadDb();
  return Object.keys(db.companies).map((slug) => writeDossier(slug, db));
}
