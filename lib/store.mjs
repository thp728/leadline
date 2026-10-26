import fs from "node:fs";
import path from "node:path";

/**
 * JSON store. Deliberately boring: one file, atomic writes, no native modules,
 * no database server. At a few hundred leads this is faster to work with than
 * SQL and every change is diffable.
 *
 * Everything personal lives under data/ and is gitignored.
 */

const ROOT = process.env.LEADLINE_DATA || path.join(process.cwd(), "data");
const DB_PATH = path.join(ROOT, "db.json");
const DOSSIER_DIR = path.join(ROOT, "dossiers");

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

export function now() {
  return new Date().toISOString();
}

export function dataRoot() {
  return ROOT;
}

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function emptyDb() {
  return { version: 1, updatedAt: null, companies: {}, outreach: {} };
}

export function loadDb() {
  if (!fs.existsSync(DB_PATH)) return emptyDb();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (err) {
    throw new Error(`db.json is not readable (${err.message}). Fix or remove ${DB_PATH}.`);
  }
}

function saveDb(db) {
  fs.mkdirSync(ROOT, { recursive: true });
  db.updatedAt = now();
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
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

function findByDomain(db, domain) {
  if (!domain) return null;
  return Object.values(db.companies).find((c) => domainOf(c.website) === domain) || null;
}

function mergeSources(prev = [], incoming = []) {
  const byKey = new Map(prev.map((s) => [`${s.source}|${s.url}`, s]));
  for (const s of incoming) {
    const key = `${s.source}|${s.url}`;
    byKey.set(key, { ...(byKey.get(key) || {}), ...s, fetchedAt: s.fetchedAt || now() });
  }
  return [...byKey.values()];
}

/**
 * Insert or merge a company. Dedupes by domain when one is known, so "Bolna"
 * from YC and "bolna.ai" from an ATS probe land on the same record.
 */
export function upsertCompany(input) {
  const db = loadDb();
  const domain = domainOf(input.website);
  const existing = findByDomain(db, domain);
  const slug = existing?.slug || input.slug || slugify(input.name);
  const prev = db.companies[slug] || {};
  const ts = now();

  const next = {
    ...prev,
    ...input,
    slug,
    createdAt: prev.createdAt || ts,
    updatedAt: ts,
    sources: mergeSources(prev.sources, input.sources),
  };

  db.companies[slug] = next;
  if (!db.outreach[slug]) {
    db.outreach[slug] = {
      stage: "sourced",
      channel: null,
      firstTouch: null,
      lastTouch: null,
      nextTouch: null,
      proofLink: null,
      notes: "",
    };
  }
  saveDb(db);
  return next;
}

export function getCompany(slug) {
  const db = loadDb();
  const company = db.companies[slug];
  if (!company) return null;
  return { company, outreach: db.outreach[slug] || { stage: "sourced" } };
}

export function updateOutreach(slug, patch) {
  const db = loadDb();
  if (!db.companies[slug]) throw new Error(`unknown company: ${slug}`);
  const prev = db.outreach[slug] || { stage: "sourced" };
  db.outreach[slug] = { ...prev, ...patch, updatedAt: now() };
  saveDb(db);
  return db.outreach[slug];
}

export function updateCompany(slug, patch) {
  const db = loadDb();
  const prev = db.companies[slug];
  if (!prev) throw new Error(`unknown company: ${slug}`);
  db.companies[slug] = { ...prev, ...patch, slug, updatedAt: now() };
  saveDb(db);
  return db.companies[slug];
}

/**
 * List with the outreach row merged in. Filters are intentionally simple; the
 * dataset is small enough that filtering in memory is honest.
 */
export function listLeads({ stage, q, hasRoles, source, limit } = {}) {
  const db = loadDb();
  let rows = Object.keys(db.companies).map((slug) => ({
    ...db.companies[slug],
    outreach: db.outreach[slug] || { stage: "sourced" },
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

export function stats() {
  const db = loadDb();
  const rows = Object.keys(db.companies).map((slug) => db.outreach[slug]?.stage || "sourced");
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const s of rows) byStage[s] = (byStage[s] || 0) + 1;
  const withRoles = Object.values(db.companies).filter((c) => (c.hiring?.roles?.length || 0) > 0).length;
  const withContact = Object.values(db.companies).filter((c) => (c.people || []).some((p) => p.email || p.handle)).length;
  return { total: rows.length, byStage, withRoles, withContact, updatedAt: db.updatedAt };
}

function bullet(label, value) {
  return value ? `- **${label}:** ${value}` : null;
}

/** Human- and agent-readable dossier. Regenerated on every upsert/enrich. */
export function writeDossier(slug) {
  const db = loadDb();
  const c = db.companies[slug];
  if (!c) return null;
  const o = db.outreach[slug] || {};

  const lines = [
    `# ${c.name}`,
    "",
    bullet("Website", c.website),
    bullet("Batch", c.batch),
    bullet("Headcount", c.teamSize),
    bullet("Stage", c.stage),
    bullet("Location", c.location),
    bullet("Domain", domainOf(c.website)),
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
    "## People",
    (c.people || []).length
      ? (c.people || [])
          .map(
            (p) =>
              `- **${p.name}**${p.role ? `, ${p.role}` : ""}${p.handle ? ` — ${p.handle}` : ""}${
                p.email ? ` — ${p.email}${p.emailVerified ? " (verified)" : " (unverified)"}` : ""
              }`,
          )
          .join("\n")
      : "_Unknown. Find a named human before drafting: founder, CTO, or the engineer who owns the area._",
    "",
    "## Outreach",
    `- **Stage:** ${o.stage || "sourced"}`,
    bullet("Channel", o.channel),
    bullet("First touch", o.firstTouch),
    bullet("Last touch", o.lastTouch),
    bullet("Next touch", o.nextTouch),
    bullet("Proof link", o.proofLink),
    "",
    "## Notes",
    o.notes || c.notes || "_None._",
    "",
    "## Provenance",
    ...(c.sources || []).map((s) => `- ${s.source}: ${s.url} (fetched ${s.fetchedAt})`),
    "",
  ];

  const text = lines.filter((l) => l !== null).join("\n");
  fs.mkdirSync(DOSSIER_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOSSIER_DIR, `${slug}.md`), text);
  return text;
}

export function writeAllDossiers() {
  const db = loadDb();
  return Object.keys(db.companies).map((slug) => writeDossier(slug));
}
