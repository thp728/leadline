#!/usr/bin/env node
/**
 * Write the mock corpus to a gitignored directory so the UI has something real
 * to render before any real lead exists.
 *
 *   npm run mock
 *   npm run mock -- --out data-mock --today 2026-10-27
 *
 * The fixture is deterministic for a given day: same `today`, same bytes. It is
 * written under its own root (`data-mock` by default) and never touches `data/`,
 * which holds the personal corpus. Dossiers are regenerated from the mock JSON,
 * so the Markdown the agent reads matches the JSON the UI reads.
 */

import fs from "node:fs";
import path from "node:path";

import { buildMockDb } from "./mock-data.mjs";
import { writeAllDossiers } from "../lib/store.mjs";

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

function isoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--today must be YYYY-MM-DD, got ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`--today is not a date: ${value}`);
  return date;
}

const realData = path.resolve(process.cwd(), "data");
const out = path.resolve(process.cwd(), flag("out", "data-mock"));
const today = flag("today", null);

// The whole point of the separate root is that the personal corpus is out of
// reach. Refuse loudly rather than trusting a typo'd --out.
if (out === realData || out.startsWith(`${realData}${path.sep}`)) {
  throw new Error(`refusing to write mock data into ${realData} (that is the real corpus)`);
}

const db = buildMockDb({ today: today ? isoDay(today) : new Date() });

fs.mkdirSync(out, { recursive: true });

const dbFile = path.join(out, "db.json");
const tmp = `${dbFile}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(db, null, 2)}\n`);
fs.renameSync(tmp, dbFile);

// A dossier left over from an earlier fixture run would describe a company that
// no longer exists, so the directory is rebuilt rather than merged.
fs.rmSync(path.join(out, "dossiers"), { recursive: true, force: true });

process.env.LEADLINE_DATA = out;
const dossiers = writeAllDossiers();

const leads = Object.values(db.leads);
const byStatus = {};
for (const lead of leads) byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;

console.log(`mock corpus -> ${dbFile}`);
console.log(
  `${Object.keys(db.companies).length} companies, ${leads.length} leads, ${dossiers.length} dossiers`,
);
console.log(
  Object.entries(byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}:${count}`)
    .join("  "),
);
console.log(`run the UI against it with: npm run dev:mock`);
