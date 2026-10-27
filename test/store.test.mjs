import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";

/**
 * The store owns two things the domain core cannot prove on its own: the
 * one-time migration write-back, and that a named human becomes a Lead on disk
 * with an identity that survives edits. Everything here runs against a
 * throwaway data root, so no personal corpus is ever touched.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "leadline-test-"));
process.env.LEADLINE_DATA = root;
const store = await import("../lib/store.mjs");

const DB_PATH = path.join(root, "db.json");

const v1 = {
  version: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  companies: {
    acme: {
      slug: "acme",
      name: "Acme",
      website: "https://acme.example",
      batch: "S21",
      batchYear: 2021,
      batchSeason: "summer",
      teamSize: 4,
      stage: "Seed",
      location: "Pune, India",
      regions: ["India"],
      oneLiner: "Invented fixture company.",
      tags: ["SaaS"],
      hiring: {
        ats: "greenhouse",
        boardId: "acme",
        roles: [{ title: "Founding Engineer" }],
        fetchedAt: "2026-09-01T00:00:00.000Z",
      },
      sources: [{ source: "yc", url: "https://www.ycombinator.com/companies/acme", fetchedAt: "2026-10-01" }],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    "northwind-ai": {
      slug: "northwind",
      name: "Northwind AI",
      website: "https://northwind.example",
      batch: "W24",
      batchYear: 2024,
      teamSize: 12,
      location: "Bengaluru, India",
      sources: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  },
  outreach: {
    acme: { stage: "sent", channel: "email", notes: "v0 state, discarded rather than reinterpreted" },
    "northwind-ai": { stage: "sourced", channel: null, notes: "" },
  },
};

fs.writeFileSync(DB_PATH, JSON.stringify(v1, null, 2));

test("loading a v0 file migrates it once and writes it back", async (t) => {
  const db = store.loadDb();

  await t.test("stamps version 2 and drops the v0 outreach map", () => {
    assert.equal(db.version, 2);
    assert.equal(db.outreach, undefined);
    assert.deepEqual(db.people, {});
    assert.deepEqual(db.leads, {});
  });

  await t.test("keeps every company and its facts", () => {
    assert.deepEqual(Object.keys(db.companies).sort(), ["acme", "northwind-ai"]);
    const acme = db.companies.acme;
    assert.equal(acme.name, "Acme");
    assert.equal(acme.website, "https://acme.example");
    assert.equal(acme.batchYear, 2021);
    assert.equal(acme.teamSize, 4);
    assert.equal(acme.stage, "Seed");
    assert.equal(acme.hiring.boardId, "acme");
    assert.equal(acme.sources.length, 1);
  });

  await t.test("stamps every company untriaged", () => {
    assert.equal(db.companies.acme.researchStatus, "untriaged");
    assert.equal(db.companies["northwind-ai"].researchStatus, "untriaged");
  });

  await t.test("treats the map key as the canonical slug", () => {
    assert.equal(db.companies["northwind-ai"].slug, "northwind-ai");
  });

  await t.test("writes version 2 to disk", () => {
    const written = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    assert.equal(written.version, 2);
    assert.equal(written.companies.acme.researchStatus, "untriaged");
    assert.equal(written.outreach, undefined);
  });

  await t.test("does not write again on the second load", () => {
    const first = fs.readFileSync(DB_PATH, "utf8");
    store.loadDb();
    assert.equal(fs.readFileSync(DB_PATH, "utf8"), first);
  });
});

test("naming a human creates a Lead", async (t) => {
  const { person, lead } = store.addPerson("acme", {
    name: "Priya Sharma",
    role: "Founder",
    handle: "@priya",
    email: "priya@acme.example",
    contactSource: "https://acme.example/team",
  });

  await t.test("gives the Lead its own identity", () => {
    assert.equal(lead.leadId, "acme--priya-sharma");
    assert.equal(person.personId, lead.leadId);
    assert.equal(lead.companySlug, "acme");
    assert.equal(lead.personId, person.personId);
  });

  await t.test("starts it at sourced with no attempts", () => {
    assert.equal(lead.status, "sourced");
    assert.equal(lead.ask, "conversation");
    assert.deepEqual(lead.attempts, []);
    assert.equal(lead.nextTouch, null);
    assert.equal(lead.revisitAfter, null);
  });

  await t.test("stores contact provenance and never claims verification", () => {
    assert.equal(person.name, "Priya Sharma");
    assert.equal(person.role, "Founder");
    assert.equal(person.handle, "@priya");
    assert.equal(person.contactSource, "https://acme.example/team");
    assert.equal(person.emailVerified, false);
    assert.equal(person.verifiedAt, null);
  });

  await t.test("keeps a source and a date for the contact fact", () => {
    assert.equal(person.sources.length, 1);
    assert.equal(person.sources[0].source, "manual");
    assert.equal(person.sources[0].url, "https://acme.example/team");
    assert.ok(person.sources[0].fetchedAt);
  });

  await t.test("makes the Lead visible from the Company", () => {
    const row = store.getCompany("acme");
    assert.equal(row.leads.length, 1);
    assert.equal(row.leads[0].leadId, "acme--priya-sharma");
    assert.equal(row.leads[0].person.name, "Priya Sharma");
  });

  await t.test("refuses an unknown company or an unnamed person", () => {
    assert.throws(() => store.addPerson("unknown", { name: "Nobody" }), /unknown company: unknown/);
    assert.throws(() => store.addPerson("acme", { name: "  " }), /a person needs a name/);
  });
});

test("two people at one Company are two Leads with independent statuses", async (t) => {
  const asha = store.addPerson("acme", { name: "Asha Rao", role: "CTO" }).lead;
  const vikram = store.addPerson("acme", { name: "Vikram Sethi", role: "Engineer" }).lead;

  await t.test("keeps distinct ids", () => {
    assert.notEqual(asha.leadId, vikram.leadId);
    assert.equal(asha.leadId, "acme--asha-rao");
    assert.equal(vikram.leadId, "acme--vikram-sethi");
  });

  await t.test("moves one without moving the other", () => {
    store.setLeadStatus(asha.leadId, "drafted");
    const row = store.getCompany("acme");
    assert.equal(row.leads.find((l) => l.leadId === asha.leadId).status, "drafted");
    assert.equal(row.leads.find((l) => l.leadId === vikram.leadId).status, "sourced");
  });

  await t.test("refuses an illegal jump with the legal set named", () => {
    assert.throws(
      () => store.setLeadStatus(asha.leadId, "offer"),
      /illegal lead status transition: drafted → offer \(legal from drafted: sent, declined, ghosted, revisit\)/,
    );
  });

  await t.test("keeps the attempt history independent", () => {
    const row = store.getCompany("acme");
    for (const l of row.leads) assert.deepEqual(l.attempts, []);
  });
});

test("Lead ids survive a rename and collide safely on repeated names", async (t) => {
  const first = store.addPerson("acme", {
    name: "Dev Kumar",
    role: "Founder",
    contactSource: "https://acme.example/team",
  });
  const second = store.addPerson("acme", { name: "Dev Kumar" }).lead;
  const third = store.addPerson("acme", { name: "Dev Kumar" }).lead;

  await t.test("suffixes repeated names with -2 and -3", () => {
    assert.equal(first.lead.leadId, "acme--dev-kumar");
    assert.equal(second.leadId, "acme--dev-kumar-2");
    assert.equal(third.leadId, "acme--dev-kumar-3");
  });

  await t.test("never reuses an id when a name looks like a suffix", () => {
    const literal = store.addPerson("acme", { name: "Dev Kumar-2" }).lead;
    assert.notEqual(literal.leadId, second.leadId);
    assert.equal(new Set([first.lead.leadId, second.leadId, third.leadId, literal.leadId]).size, 4);
  });

  await t.test("keeps the id when the person is renamed", () => {
    const renamed = store.updatePerson(first.person.personId, { name: "Dev Kumar-Rao", role: "CEO" });
    assert.equal(renamed.personId, first.person.personId);
    assert.equal(renamed.name, "Dev Kumar-Rao");
    assert.equal(store.getCompany("acme").leads.find((l) => l.leadId === first.lead.leadId).person.name, "Dev Kumar-Rao");
  });

  await t.test("re-stamps provenance when the source changes", () => {
    const before = store.getCompany("acme").people.find((p) => p.personId === first.person.personId);
    const updated = store.updatePerson(first.person.personId, { contactSource: "https://acme.example/about" });
    assert.equal(updated.sources[0].url, "https://acme.example/about");
    assert.equal(updated.contactSource, "https://acme.example/about");
    assert.ok(before.sources[0].fetchedAt <= updated.sources[0].fetchedAt);
  });

  await t.test("gives a newly named person a fresh identity", () => {
    const fresh = store.addPerson("acme", { name: "Dev Kumar-Rao" }).lead;
    assert.equal(fresh.leadId, "acme--dev-kumar-rao");
    assert.notEqual(fresh.leadId, first.lead.leadId);
  });
});

test("research state moves through the company machine", async (t) => {
  await t.test("moves untriaged to researched to parked and back", () => {
    assert.equal(store.setResearchStatus("northwind-ai", "researched").researchStatus, "researched");
    assert.equal(store.setResearchStatus("northwind-ai", "parked").researchStatus, "parked");
    assert.equal(store.setResearchStatus("northwind-ai", "researched").researchStatus, "researched");
    assert.equal(store.setResearchStatus("northwind-ai", "untriaged").researchStatus, "untriaged");
  });

  await t.test("refuses a status it does not know and names the set", () => {
    assert.throws(
      () => store.setResearchStatus("northwind-ai", "done"),
      /unknown research status: done \(known: untriaged, researched, parked\)/,
    );
  });

  await t.test("refuses an unknown company", () => {
    assert.throws(() => store.setResearchStatus("unknown", "researched"), /unknown company: unknown/);
  });
});

test("dossiers list people and their Leads", async (t) => {
  const { lead } = store.addPerson("northwind-ai", {
    name: "Ishan Patel",
    role: "Founder",
    contactSource: "https://northwind.example/team",
  });
  store.setLeadStatus(lead.leadId, "drafted");

  const dossier = fs.readFileSync(path.join(root, "dossiers", "northwind-ai.md"), "utf8");

  await t.test("names the person and their role", () => {
    assert.match(dossier, /Ishan Patel/);
    assert.match(dossier, /Founder/);
  });

  await t.test("shows the Lead id and its current status", () => {
    assert.match(dossier, /northwind-ai--ishan-patel/);
    assert.match(dossier, /drafted/);
  });

  await t.test("shows the company research state", () => {
    assert.match(dossier, /Research/);
    assert.match(dossier, /untriaged/);
  });
});

test("stats count Leads, not companies", async () => {
  const s = store.stats();
  assert.equal(s.leads, Object.keys(store.loadDb().leads).length);
  assert.equal(s.companies, 2);
  assert.equal(s.needsHuman, 0);
  assert.equal(s.byStatus.drafted >= 1, true);
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
