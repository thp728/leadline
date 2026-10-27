import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { DB_VERSION, RESEARCH_STATUSES, LEAD_STATUSES } from "../lib/core.mjs";
import { buildMockDb } from "../scripts/mock-data.mjs";

/**
 * The mock corpus exists to prove the UI survives every shape the model allows,
 * so these tests are about coverage rather than about any one company. If a
 * status, a state, an id collision or a missing-field case disappears from the
 * fixture, a page that renders it stops being exercised.
 *
 * Fixtures are invented and dates are pinned, so a failure is reproducible.
 */

const TODAY = new Date("2026-10-27T00:00:00Z");
const db = buildMockDb({ today: TODAY });
const companies = Object.values(db.companies);
const people = Object.values(db.people);
const leads = Object.values(db.leads);

const day = (offset) => {
  const d = new Date(TODAY.getTime() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
const today = day(0);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const isoStamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const leadsAt = (slug) => leads.filter((l) => l.companySlug === slug);

test("the fixture is a complete schema-v2 corpus", () => {
  assert.equal(db.version, DB_VERSION);
  assert.ok(companies.length >= 15, `expected a broad corpus, got ${companies.length} companies`);
  assert.ok(leads.length >= 20, `expected a broad corpus, got ${leads.length} leads`);

  for (const company of companies) {
    assert.match(company.slug, /^[a-z0-9-]+$/, `${company.name} has an unusable slug`);
    assert.equal(db.companies[company.slug], company);
    assert.ok(company.name, "every company needs a name");
  }
  for (const person of people) {
    assert.equal(db.people[person.personId], person);
    assert.ok(person.name, "every person needs a name");
    assert.ok(
      person.personId.startsWith(`${person.companySlug}--`),
      `${person.personId} does not belong to ${person.companySlug}`,
    );
  }
  for (const lead of leads) {
    assert.equal(db.leads[lead.leadId], lead);
  }
  assert.equal(new Set(leads.map((l) => l.leadId)).size, leads.length);
});

test("every research state and every Lead status appears", () => {
  assert.deepEqual(new Set(companies.map((c) => c.researchStatus)), new Set(RESEARCH_STATUSES));
  assert.deepEqual(new Set(leads.map((l) => l.status)), new Set(LEAD_STATUSES));

  for (const company of companies) assert.ok(RESEARCH_STATUSES.includes(company.researchStatus));
  for (const lead of leads) assert.ok(LEAD_STATUSES.includes(lead.status), `bad status ${lead.status}`);
});

test("companies have zero, one, two and three Leads", () => {
  const counts = new Set(companies.map((c) => leadsAt(c.slug).length));
  for (const expected of [0, 1, 2, 3]) assert.ok(counts.has(expected), `no company with ${expected} leads`);
  assert.ok(companies.some((c) => leadsAt(c.slug).length === 0), "needs a research-only company");
});

test("every Lead points at a real Company and a real Person, and vice versa", () => {
  const companiesWithLeads = new Set();

  for (const lead of leads) {
    const company = db.companies[lead.companySlug];
    const person = db.people[lead.personId];
    assert.ok(company, `lead ${lead.leadId} has no company ${lead.companySlug}`);
    assert.ok(person, `lead ${lead.leadId} has no person ${lead.personId}`);
    assert.equal(person.companySlug, lead.companySlug);
    assert.equal(lead.leadId, lead.personId, "one identity serves both records");
    companiesWithLeads.add(lead.companySlug);
  }

  for (const person of people) {
    assert.ok(companiesWithLeads.has(person.companySlug), `person ${person.personId} has no lead`);
    assert.ok(db.leads[person.personId], `person ${person.personId} has no lead record`);
  }
});

test("a repeated person name takes the next free id, not an overwrite", () => {
  const collided = leadsAt("pillbox-health").filter((l) => db.people[l.personId].name === "Ananya Rao");
  assert.equal(collided.length, 2);
  assert.deepEqual(collided.map((l) => l.leadId).sort(), [
    "pillbox-health--ananya-rao",
    "pillbox-health--ananya-rao-2",
  ]);
  // The name is shared across companies too, so a search has to disambiguate by Company.
  assert.ok(leads.some((l) => l.companySlug === "kettle-labs" && db.people[l.personId].name === "Ananya Rao"));
});

test("every company fact carries provenance and a fetch date", () => {
  for (const company of companies) {
    assert.ok(company.sources?.length, `${company.slug} has no sources`);
    for (const source of company.sources) {
      assert.ok(source.source, `${company.slug} source without a name`);
      assert.ok(source.url, `${company.slug} source without a url`);
      assert.match(source.fetchedAt, isoStamp, `${company.slug} source without a timestamp`);
      assert.ok(source.fetchedAt <= `${today}T23:59:59.999Z`, `${company.slug} source is in the future`);
    }
    assert.match(company.createdAt, isoStamp);
  }
});

test("a contact detail is sourced, and an inferred email stays unverified", () => {
  for (const person of people) {
    if (person.email || person.handle) {
      assert.ok(person.sources?.length, `${person.personId} has contact detail but no source`);
      assert.ok(person.contactSource, `${person.personId} has contact detail but no contactSource`);
    }
    assert.equal(person.emailVerified, Boolean(person.email && person.verifiedAt));
    if (person.emailVerified) assert.ok(person.verifiedAt, `${person.personId} is verified without a date`);
    if (!person.email) assert.equal(person.emailVerified, false);
  }

  assert.ok(people.some((p) => p.email && !p.emailVerified), "needs an unverified email");
  assert.ok(people.some((p) => p.emailVerified), "needs a verified email");
  assert.ok(people.some((p) => !p.email && !p.handle), "needs a person with no contact detail");
});

test("attempts cover every count, channel and kind, in date order", () => {
  const counts = new Set(leads.map((l) => l.attempts.length));
  for (const expected of [0, 1, 2, 3]) assert.ok(counts.has(expected), `no lead with ${expected} attempts`);

  const channels = new Set();
  const kinds = new Set();
  for (const lead of leads) {
    let previous = "";
    for (const attempt of lead.attempts) {
      assert.match(attempt.date, isoDate, `${lead.leadId} attempt date ${attempt.date}`);
      assert.ok(attempt.date <= today, `${lead.leadId} has a future attempt`);
      assert.ok(attempt.date >= previous, `${lead.leadId} attempts are out of order`);
      previous = attempt.date;
      channels.add(attempt.channel);
      kinds.add(attempt.kind);
    }
  }
  assert.deepEqual(channels, new Set(["email", "linkedin", "x", "other"]));
  assert.deepEqual(kinds, new Set(["first", "followup"]));
});

test("dates cover overdue, due today and scheduled, for both touch and revisit", () => {
  const nextTouches = leads.map((l) => l.nextTouch).filter(Boolean);
  assert.ok(nextTouches.some((d) => d < today), "needs an overdue next touch");
  assert.ok(nextTouches.some((d) => d === today), "needs a next touch due today");
  assert.ok(nextTouches.some((d) => d > today), "needs a future next touch");

  const revisits = leads.map((l) => l.revisitAfter).filter(Boolean);
  assert.ok(revisits.some((d) => d < today), "needs a due revisit");
  assert.ok(revisits.some((d) => d > today), "needs a timed revisit");
});

test("asks and hiring signals cover the shapes the UI branches on", () => {
  const asks = new Set(leads.map((l) => l.ask));
  assert.deepEqual(asks, new Set(["conversation", "trial", "contract"]));

  const withRoles = companies.filter((c) => (c.hiring?.roles?.length || 0) > 0);
  const emptyBoard = companies.filter((c) => c.hiring && c.hiring.roles.length === 0);
  const noBoard = companies.filter((c) => !c.hiring);
  assert.ok(withRoles.length >= 5);
  assert.ok(emptyBoard.length >= 1, "needs a detected board with no open roles");
  assert.ok(noBoard.length >= 2, "needs the no-posting case");

  for (const company of withRoles) {
    assert.ok(company.hiring.fetchedAt, `${company.slug} hiring snapshot has no date`);
    for (const role of company.hiring.roles) {
      assert.ok(role.title, `${company.slug} role without a title`);
      assert.ok(role.url, `${company.slug} role without a url`);
    }
  }

  const stale = withRoles.some(
    (c) => new Date(c.hiring.fetchedAt).getTime() < TODAY.getTime() - 30 * 86400000,
  );
  assert.ok(stale, "needs a stale hiring snapshot");
  assert.ok(
    withRoles.some((c) => c.hiring.roles.some((r) => new Date(r.publishedAt).getTime() < TODAY.getTime() - 90 * 86400000)),
    "needs an old role on a fresh board",
  );
});

test("missing fields, long strings and Unicode are present", () => {
  assert.ok(companies.some((c) => !c.website));
  assert.ok(companies.some((c) => !c.batch));
  assert.ok(companies.some((c) => c.teamSize == null));
  assert.ok(companies.some((c) => !c.location));
  assert.ok(people.some((p) => !p.role));
  assert.ok(people.some((p) => !p.handle));
  assert.ok(companies.some((c) => c.name.length >= 15));
  assert.ok(people.some((p) => p.name.length >= 25), "needs a long person name");
  assert.ok(people.some((p) => p.email && p.email.length >= 40), "needs a long unbreakable email");
  assert.ok(companies.some((c) => /[^\x00-\x7F]/.test(c.name + (c.oneLiner || ""))), "needs Unicode display text");
  assert.ok(people.some((p) => /[^\x00-\x7F]/.test(p.name)), "needs a Unicode person name");
  assert.ok(companies.some((c) => !c.hiring));
  assert.ok(companies.some((c) => c.researchStatus === "parked" && !leadsAt(c.slug).length));
});

test("the same day builds the same corpus", () => {
  assert.equal(JSON.stringify(buildMockDb({ today: TODAY })), JSON.stringify(db));

  const later = buildMockDb({ today: new Date(TODAY.getTime() + 86400000) });
  assert.notEqual(JSON.stringify(later), JSON.stringify(db));
  assert.deepEqual(Object.keys(later.companies), Object.keys(db.companies));
  assert.deepEqual(Object.keys(later.leads), Object.keys(db.leads));
  assert.ok(Object.values(later.leads).some((l) => l.nextTouch === day(1)));
});

test("npm run mock writes a loadable corpus and its dossiers, outside data/", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "leadline-mock-"));
  try {
    const run = spawnSync(
      process.execPath,
      ["scripts/mock.mjs", "--out", out, "--today", "2026-10-27"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const written = JSON.parse(fs.readFileSync(path.join(out, "db.json"), "utf8"));
    assert.equal(written.version, DB_VERSION);
    assert.deepEqual(Object.keys(written.leads), Object.keys(db.leads));
    assert.equal(fs.readdirSync(path.join(out, "dossiers")).length, Object.keys(written.companies).length);

    const dossier = fs.readFileSync(path.join(out, "dossiers", "kettle-labs.md"), "utf8");
    assert.match(dossier, /^# Kettle Labs/m);
    assert.match(dossier, /Ananya Rao/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
