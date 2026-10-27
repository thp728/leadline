#!/usr/bin/env node
/**
 * leadline CLI - the agent-facing interface and the ingestion entry point.
 *
 *   node scripts/cli.mjs yc --min 5 --max 150 --loc india --limit 40
 *   node scripts/cli.mjs enrich --limit 10
 *   node scripts/cli.mjs enrich --slug bolna-ai
 *   node scripts/cli.mjs list --status sourced --json
 *   node scripts/cli.mjs add-person --company bolna-ai --name "Priya Sharma" --role Founder
 *   node scripts/cli.mjs set-research --company bolna-ai --status researched
 *   node scripts/cli.mjs log-attempt --lead bolna-ai--priya-sharma --channel email --note "Sent the teardown"
 *   node scripts/cli.mjs set-next --lead bolna-ai--priya-sharma --date 2026-11-15
 *   node scripts/cli.mjs export
 */

import { ycSource, enrichCompany } from "../lib/ingest.mjs";
import { researchRank } from "../lib/core.mjs";
import {
  listLeads,
  addPerson,
  updatePerson,
  logAttempt,
  setNextTouch,
  setResearchStatus,
  stats,
  loadDb,
  writeAllDossiers,
  RESEARCH_STATUSES,
} from "../lib/store.mjs";

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
  if (rows.length === 0) {
    console.log("no leads match");
    return;
  }
  const header = ["status", "person", "company", "batch", "loc", "roles", "next"];
  const lines = rows.map((r) => [
    r.status,
    r.person?.name || "",
    r.company?.name || "",
    r.company?.batch || "",
    (r.company?.location || "").split(",")[0],
    r.company?.hiring?.roles?.length ?? "",
    r.nextTouch || "",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (l) => l.map((v, i) => String(v).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const l of lines) console.log(fmt(l));
}

/** Companies with nobody named first, then the newest batch: the research queue. */
function researchQueue(limit) {
  const db = loadDb();
  const hasLead = new Set(Object.values(db.leads).map((l) => l.companySlug));
  return Object.values(db.companies)
    .filter((c) => !hasLead.has(c.slug))
    .sort((a, b) => researchRank(a.researchStatus) - researchRank(b.researchStatus) || (b.batchYear || 0) - (a.batchYear || 0))
    .slice(0, limit);
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
      for (const c of researchQueue(limit)) {
        try {
          const res = await enrichCompany(c.slug);
          console.log(`${res.name}: ${res.ats ? `${res.ats} / ${res.openRoles} roles` : "no ATS"}`);
        } catch (err) {
          console.log(`${c.name}: ERROR ${err.message}`);
        }
      }
    }
  } else if (cmd === "list") {
    print(
      listLeads({
        status: f.status,
        q: f.q,
        source: f.source,
        hasRoles: Boolean(f["has-roles"]),
        limit: f.limit ? Number(f.limit) : undefined,
      }),
      Boolean(f.json),
    );
  } else if (cmd === "stats") {
    console.log(JSON.stringify(stats(), null, 2));
  } else if (cmd === "add-person") {
    if (!f.company) throw new Error("--company is required");
    if (!f.name) throw new Error("--name is required");
    const { person, lead } = addPerson(String(f.company), {
      name: String(f.name),
      role: f.role,
      handle: f.handle,
      email: f.email,
      contactSource: f.source,
    });
    console.log(JSON.stringify({ person, lead }, null, 2));
  } else if (cmd === "update-person") {
    if (!f.lead) throw new Error("--lead is required (the person's id, e.g. bolna-ai--priya-sharma)");
    const patch = {};
    for (const key of ["name", "role", "handle", "email"]) {
      if (f[key] !== undefined) patch[key] = String(f[key]);
    }
    if (f.source !== undefined) patch.contactSource = String(f.source);
    if (Object.keys(patch).length === 0) throw new Error("nothing to change");
    console.log(JSON.stringify(updatePerson(String(f.lead), patch), null, 2));
  } else if (cmd === "set-research") {
    if (!f.company) throw new Error("--company is required");
    if (!f.status) throw new Error("--status is required");
    if (!RESEARCH_STATUSES.includes(f.status)) {
      throw new Error(`status must be one of: ${RESEARCH_STATUSES.join(", ")}`);
    }
    console.log(JSON.stringify(setResearchStatus(String(f.company), String(f.status)), null, 2));
  } else if (cmd === "log-attempt") {
    if (!f.lead) throw new Error("--lead is required (e.g. bolna-ai--priya-sharma)");
    const leadId = String(f.lead);
    const res = logAttempt(leadId, {
      date: f.date,
      channel: f.channel,
      kind: f.kind,
      note: f.note,
      // The ladder's date is applied unless refused; a ghosted status always
      // needs --ghost, because that is a decision, not arithmetic.
      accept: !f["no-accept"] && !f["no-next"],
      ghost: Boolean(f.ghost),
    });

    let lead = res.lead;
    if (f.next) lead = setNextTouch(leadId, String(f.next));
    if (f["no-next"]) lead = setNextTouch(leadId, null);

    if (f.json) {
      console.log(JSON.stringify({ attempt: res.attempt, suggestion: res.suggestion, lead }, null, 2));
    } else {
      const a = res.attempt;
      console.log(`logged ${a.date} · ${a.channel} · ${a.kind}${a.note ? ` — ${a.note}` : ""}`);
      if (res.suggestion.stopped) {
        console.log("ladder stopped (replied or past sent): set the next date yourself");
      } else if (res.suggestion.status === "ghosted") {
        console.log(`${res.suggestion.count} unanswered Attempts: suggested ghosted, no next date`);
      } else if (res.suggestion.nextTouch) {
        const applied = res.lead.nextTouch === res.suggestion.nextTouch ? " — applied" : " — not applied";
        console.log(`suggested next touch ${res.suggestion.nextTouch} (+${res.suggestion.days} days)${applied}`);
      }
      console.log(
        `next touch: ${lead.nextTouch || "none"}${lead.nextTouchOverride ? " (overridden)" : ""} · status: ${lead.status}`,
      );
    }
  } else if (cmd === "set-next") {
    if (!f.lead) throw new Error("--lead is required (e.g. bolna-ai--priya-sharma)");
    if (!f.clear && !f.date) throw new Error("--date is required (or --clear to hand the date back)");
    console.log(JSON.stringify(setNextTouch(String(f.lead), f.clear ? null : String(f.date)), null, 2));
  } else if (cmd === "dossiers") {
    writeAllDossiers();
    console.log("dossiers rewritten");
  } else if (cmd === "export") {
    const db = loadDb();
    console.log(
      `${Object.keys(db.companies).length} companies, ${Object.keys(db.people).length} people, ${Object.keys(db.leads).length} leads in data/db.json`,
    );
  } else {
    console.log(`leadline

  yc           --min 5 --max 150 --loc india --limit 40
  enrich       [--slug <slug> | --limit 10]
  list         [--status sourced] [--source yc] [--has-roles] [--q text] [--json]
  add-person   --company <slug> --name "Priya Sharma" [--role Founder] [--handle @priya] [--email ...] [--source url]
  update-person --lead <leadId> [--name ...] [--role ...] [--handle ...] [--email ...] [--source url]
  set-research --company <slug> --status ${RESEARCH_STATUSES.join("|")}
  log-attempt  --lead <leadId> --channel email|linkedin|x|other [--kind first|followup] [--date YYYY-MM-DD]
               [--note "..."] [--no-accept] [--next YYYY-MM-DD | --no-next] [--ghost] [--json]
  set-next     --lead <leadId> (--date YYYY-MM-DD | --clear)
  stats
  dossiers
  export
`);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
