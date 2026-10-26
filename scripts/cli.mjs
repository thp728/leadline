#!/usr/bin/env node
/**
 * leadline CLI - the agent-facing interface and the ingestion entry point.
 *
 *   node scripts/cli.mjs yc --min 5 --max 150 --loc india --limit 40
 *   node scripts/cli.mjs enrich --limit 10
 *   node scripts/cli.mjs enrich --slug bolna-ai
 *   node scripts/cli.mjs list --stage sourced --json
 *   node scripts/cli.mjs set --slug bolna-ai --stage sent --channel email --next 2026-11-02
 *   node scripts/cli.mjs export
 */

import { ycSource, enrichCompany } from "../lib/ingest.mjs";
import { listLeads, updateOutreach, stats, loadDb, writeAllDossiers, STAGES, CHANNELS } from "../lib/store.mjs";

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const f = flags(rest);

function print(rows, asJson) {
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const header = ["stage", "company", "batch", "size", "loc", "roles", "next"];
  const lines = rows.map((r) => [
    r.outreach?.stage || "sourced",
    r.name,
    r.batch || "",
    r.teamSize ?? "",
    (r.location || "").split(",")[0],
    r.hiring?.roles?.length ?? "",
    r.outreach?.nextTouch || "",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (l) => l.map((v, i) => String(v).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const l of lines) console.log(fmt(l));
}

try {
  if (cmd === "yc") {
    const res = await ycSource({
      min: Number(f.min ?? 5),
      max: Number(f.max ?? 150),
      loc: f.loc || "india",
      limit: Number(f.limit ?? 40),
    });
    console.log(`matched ${res.matched}, saved ${res.saved.length}`);
    for (const s of res.saved) console.log(`  ${s}`);
  } else if (cmd === "enrich") {
    if (f.slug) {
      const res = await enrichCompany(String(f.slug));
      console.log(JSON.stringify(res, null, 2));
    } else {
      const limit = Number(f.limit ?? 10);
      const rows = listLeads({ stage: f.stage }).slice(0, limit);
      for (const r of rows) {
        try {
          const res = await enrichCompany(r.slug);
          console.log(`${res.name}: ${res.ats ? `${res.ats} / ${res.openRoles} roles` : "no ATS"}`);
        } catch (err) {
          console.log(`${r.name}: ERROR ${err.message}`);
        }
      }
    }
  } else if (cmd === "list") {
    print(
      listLeads({
        stage: f.stage,
        q: f.q,
        source: f.source,
        hasRoles: Boolean(f["has-roles"]),
        limit: f.limit ? Number(f.limit) : undefined,
      }),
      Boolean(f.json),
    );
  } else if (cmd === "stats") {
    console.log(JSON.stringify(stats(), null, 2));
  } else if (cmd === "set") {
    if (!f.slug) throw new Error("--slug is required");
    if (f.stage && !STAGES.includes(f.stage)) throw new Error(`stage must be one of: ${STAGES.join(", ")}`);
    if (f.channel && !CHANNELS.includes(f.channel)) throw new Error(`channel must be one of: ${CHANNELS.join(", ")}`);
    const patch = {};
    for (const k of ["stage", "channel", "firstTouch", "lastTouch", "nextTouch", "proofLink", "notes"]) {
      if (f[k] !== undefined) patch[k] = String(f[k]);
    }
    console.log(JSON.stringify(updateOutreach(String(f.slug), patch), null, 2));
  } else if (cmd === "dossiers") {
    writeAllDossiers();
    console.log("dossiers rewritten");
  } else if (cmd === "export") {
    const db = loadDb();
    console.log(`${Object.keys(db.companies).length} companies in data/db.json`);
  } else {
    console.log(`leadline

  yc       --min 5 --max 150 --loc india --limit 40
  enrich   [--slug <slug> | --limit 10]
  list     [--stage sourced] [--source yc] [--has-roles] [--q text] [--json]
  set      --slug <slug> [--stage sent] [--channel email] [--next 2026-11-02] [--notes "..."]
  stats
  dossiers
`);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
