import test from "node:test";
import assert from "node:assert/strict";

import {
  DB_VERSION,
  RESEARCH_STATUSES,
  LEAD_STATUSES,
  slugify,
  domainOf,
  findByDomain,
  slugForCompany,
  leadIdFor,
  companySlugOf,
  legalResearchTransitions,
  assertResearchTransition,
  legalLeadTransitions,
  assertLeadTransition,
  migrateDb,
  selectLeads,
} from "../lib/core.mjs";

/**
 * Characterising tests for the domain core. Plain data in, plain data out: no
 * filesystem, no clock, no network. A later refactor can move code without
 * changing what the app, the CLI or an agent sees.
 *
 * Fixtures are invented (Acme, Northwind, Quill, Zephyr). Real lead data never
 * enters git. Schema v2 is the shape under test: Companies carry public facts
 * and a research state, People are named humans, and a Lead is one person at
 * one Company.
 */

const company = (overrides) => ({
  slug: overrides.slug,
  name: overrides.name,
  website: overrides.website ?? null,
  batch: overrides.batch ?? null,
  batchYear: overrides.batchYear ?? 0,
  batchSeason: overrides.batchSeason ?? "",
  teamSize: overrides.teamSize ?? null,
  stage: overrides.stage ?? null,
  location: overrides.location ?? null,
  regions: overrides.regions ?? [],
  oneLiner: overrides.oneLiner ?? null,
  tags: overrides.tags ?? [],
  researchStatus: overrides.researchStatus ?? "untriaged",
  hiring: overrides.hiring ?? null,
  sources: overrides.sources ?? [],
});

const person = (companySlug, name, overrides = {}) => ({
  personId: `${companySlug}--${slugify(name)}`,
  companySlug,
  name,
  role: overrides.role ?? null,
  handle: overrides.handle ?? null,
  email: overrides.email ?? null,
  emailVerified: overrides.emailVerified ?? false,
  contactSource: overrides.contactSource ?? null,
  verifiedAt: overrides.verifiedAt ?? null,
  createdAt: overrides.createdAt ?? "2026-10-01T00:00:00.000Z",
});

const lead = (companySlug, name, overrides = {}) => ({
  leadId: `${companySlug}--${slugify(name)}`,
  companySlug,
  personId: `${companySlug}--${slugify(name)}`,
  status: overrides.status ?? "sourced",
  pitch: overrides.pitch ?? "",
  ask: overrides.ask ?? "conversation",
  attempts: overrides.attempts ?? [],
  nextTouch: overrides.nextTouch ?? null,
  revisitAfter: overrides.revisitAfter ?? null,
  proofLink: overrides.proofLink ?? null,
  notes: overrides.notes ?? "",
  createdAt: overrides.createdAt ?? "2026-10-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-10-01T00:00:00.000Z",
});

const companies = {
  "northwind-ai": company({
    slug: "northwind-ai",
    name: "Northwind AI",
    website: "https://www.northwind.example",
    batch: "W24",
    batchYear: 2024,
    batchSeason: "winter",
    teamSize: 12,
    location: "Bengaluru, India",
    researchStatus: "researched",
    hiring: { ats: "greenhouse", boardId: "northwind", roles: [{ title: "Founding Engineer" }] },
    sources: [{ source: "yc", url: "https://www.ycombinator.com/companies/northwind" }],
  }),
  quill: company({
    slug: "quill",
    name: "Quill",
    website: "https://quill.example",
    batch: "S21",
    batchYear: 2021,
    batchSeason: "summer",
    teamSize: 90,
    location: "Hyderabad, India",
    hiring: { ats: "ashby", boardId: "quill", roles: [] },
    sources: [{ source: "ats:ashby", url: "https://jobs.ashbyhq.com/quill" }],
  }),
  zephyr: company({
    slug: "zephyr",
    name: "Zephyr",
    website: "https://zephyr.example",
    batch: "S21",
    batchYear: 2021,
    batchSeason: "summer",
    teamSize: 30,
    location: "Pune, India",
    researchStatus: "parked",
    sources: [{ source: "probe", url: "https://zephyr.example" }],
  }),
};

const people = {
  "northwind-ai--priya-sharma": person("northwind-ai", "Priya Sharma", { role: "Founder" }),
  "quill--rahul-verma": person("quill", "Rahul Verma", { role: "CTO" }),
  "zephyr--meera-iyer": person("zephyr", "Meera Iyer", { role: "Head of Engineering" }),
};

const leads = {
  "northwind-ai--priya-sharma": lead("northwind-ai", "Priya Sharma", {
    status: "sent",
    nextTouch: "2026-11-02",
  }),
  "quill--rahul-verma": lead("quill", "Rahul Verma"),
  "zephyr--meera-iyer": lead("zephyr", "Meera Iyer"),
};

const leadIds = (rows) => rows.map((r) => r.leadId);

test("slug derivation", async (t) => {
  const cases = [
    { name: "derives a kebab-case slug from a company name", input: "Northwind AI", expected: "northwind-ai" },
    { name: "keeps a single-word name intact", input: "Zephyr", expected: "zephyr" },
    { name: "separates words that were only distinguished by case", input: "QuestHarbor", expected: "questharbor" },
    { name: "turns an ampersand into the word and", input: "A & B", expected: "a-and-b" },
    { name: "trims leading and trailing punctuation", input: "  --Hello, World!!  ", expected: "hello-world" },
    { name: "caps the slug at 64 characters", input: "a".repeat(70), expected: "a".repeat(64) },
    { name: "returns an empty slug for no name", input: "", expected: "" },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      assert.equal(slugify(c.input), c.expected);
    });
  }

  await t.test("derives the same slug for the same name", () => {
    assert.equal(slugify("Northwind AI"), "northwind-ai");
    assert.equal(slugify("northwind ai"), "northwind-ai");
  });
});

test("domain derivation", async (t) => {
  const cases = [
    { name: "strips the scheme, www and path", input: "https://www.Northwind.example/careers", expected: "northwind.example" },
    { name: "accepts a bare host", input: "northwind.example", expected: "northwind.example" },
    { name: "accepts a www host without a scheme", input: "www.northwind.example", expected: "northwind.example" },
    { name: "lowercases the host", input: "HTTPS://NORTHWIND.EXAMPLE", expected: "northwind.example" },
    { name: "ignores a trailing slash", input: "https://quill.example/", expected: "quill.example" },
    { name: "returns empty for no website", input: "", expected: "" },
    { name: "returns empty for a missing website", input: null, expected: "" },
    { name: "returns empty for an unparseable website", input: "not a domain", expected: "" },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      assert.equal(domainOf(c.input), c.expected);
    });
  }

  await t.test("derives the same domain for www. and bare hosts", () => {
    assert.equal(domainOf("www.northwind.example"), domainOf("northwind.example"));
    assert.equal(domainOf("https://www.northwind.example"), domainOf("http://northwind.example"));
  });
});

test("dedupe by domain", async (t) => {
  const records = {
    "northwind-ai": { slug: "northwind-ai", name: "Northwind AI", website: "https://www.Northwind.example" },
    acme: { slug: "acme", name: "Acme", website: "acme.example" },
  };

  await t.test("finds a record by the domain of its website", () => {
    assert.equal(findByDomain(records, domainOf("northwind.example")), records["northwind-ai"]);
  });

  await t.test("treats www. and bare hosts as the same record", () => {
    assert.equal(findByDomain(records, domainOf("www.northwind.example")), records["northwind-ai"]);
    assert.equal(findByDomain(records, domainOf("http://NORTHWIND.example")), records["northwind-ai"]);
  });

  await t.test("returns null for a domain no record owns", () => {
    assert.equal(findByDomain(records, domainOf("unknown.example")), null);
  });

  await t.test("returns null for an empty domain", () => {
    assert.equal(findByDomain(records, ""), null);
    assert.equal(findByDomain(records, domainOf("")), null);
  });

  await t.test("returns null when there are no records", () => {
    assert.equal(findByDomain({}, "northwind.example"), null);
  });
});

test("slug for an incoming company", async (t) => {
  const records = {
    "northwind-ai": { slug: "northwind-ai", name: "Northwind AI", website: "https://www.northwind.example" },
  };

  await t.test("lands a known domain on the existing record's slug", () => {
    assert.equal(slugForCompany(records, { name: "Northwind", website: "northwind.example" }), "northwind-ai");
  });

  await t.test("lets the existing record win over an explicit slug", () => {
    assert.equal(
      slugForCompany(records, { slug: "duplicate", name: "Northwind", website: "https://www.northwind.example" }),
      "northwind-ai",
    );
  });

  await t.test("keeps an explicit slug for a new domain", () => {
    assert.equal(slugForCompany(records, { slug: "custom", name: "Other", website: "other.example" }), "custom");
  });

  await t.test("derives a slug from the name when nothing else is given", () => {
    assert.equal(slugForCompany({}, { name: "New Co" }), "new-co");
  });

  await t.test("returns an empty slug for an empty input", () => {
    assert.equal(slugForCompany({}, {}), "");
  });
});

test("Lead identity", async (t) => {
  await t.test("is the company slug and the person slug, legibly joined", () => {
    assert.equal(leadIdFor("northwind-ai", "Priya Sharma"), "northwind-ai--priya-sharma");
  });

  await t.test("derives the person half with the same slug rules as a company", () => {
    assert.equal(leadIdFor("acme", "  Priya   Sharma!! "), "acme--priya-sharma");
    assert.equal(leadIdFor("acme", "A & B"), "acme--a-and-b");
  });

  await t.test("keeps two people at different companies distinct", () => {
    assert.notEqual(leadIdFor("quill", "Priya Sharma"), leadIdFor("zephyr", "Priya Sharma"));
  });

  await t.test("suffixes a repeated name with -2 then -3", () => {
    const taken = ["acme--priya-sharma", "acme--priya-sharma-2"];
    assert.equal(leadIdFor("acme", "Priya Sharma", taken), "acme--priya-sharma-3");
    assert.equal(
      leadIdFor("acme", "Priya Sharma", ["acme--priya-sharma", "acme--priya-sharma-2", "acme--priya-sharma-3"]),
      "acme--priya-sharma-4",
    );
  });

  await t.test("does not collide across companies with the same person name", () => {
    const taken = ["quill--priya-sharma"];
    assert.equal(leadIdFor("zephyr", "Priya Sharma", taken), "zephyr--priya-sharma");
  });

  await t.test("returns an empty id when the company or the person is unnamed", () => {
    assert.equal(leadIdFor("", "Priya Sharma"), "");
    assert.equal(leadIdFor("acme", ""), "");
    assert.equal(leadIdFor("acme", "  "), "");
  });

  await t.test("recovers the company half of an id", () => {
    assert.equal(companySlugOf("northwind-ai--priya-sharma"), "northwind-ai");
    assert.equal(companySlugOf("acme--priya-sharma-3"), "acme");
    assert.equal(companySlugOf("single"), "single");
    assert.equal(companySlugOf(""), "");
    assert.equal(companySlugOf(undefined), "");
  });
});

test("lead status machine", async (t) => {
  await t.test("names the legal next statuses from each status", () => {
    assert.deepEqual(legalLeadTransitions("sourced"), ["drafted", "declined", "ghosted", "revisit"]);
    assert.deepEqual(legalLeadTransitions("sent"), ["replied", "declined", "ghosted", "revisit"]);
    assert.deepEqual(legalLeadTransitions("ghosted"), ["replied", "revisit", "declined"]);
    assert.deepEqual(legalLeadTransitions("offer"), ["declined", "revisit", "ghosted"]);
    assert.deepEqual(legalLeadTransitions("declined"), []);
  });

  await t.test("knows every status it names", () => {
    for (const status of LEAD_STATUSES) {
      for (const next of legalLeadTransitions(status)) {
        assert.ok(LEAD_STATUSES.includes(next), `${status} points at unknown ${next}`);
      }
    }
  });

  await t.test("walks the pipeline in order", () => {
    assert.equal(assertLeadTransition("sourced", "drafted"), "drafted");
    assert.equal(assertLeadTransition("drafted", "sent"), "sent");
    assert.equal(assertLeadTransition("sent", "replied"), "replied");
    assert.equal(assertLeadTransition("replied", "call"), "call");
    assert.equal(assertLeadTransition("call", "trial"), "trial");
    assert.equal(assertLeadTransition("trial", "offer"), "offer");
  });

  await t.test("allows the side exits from every active status", () => {
    for (const from of ["sourced", "drafted", "sent", "replied", "call", "trial"]) {
      for (const to of ["declined", "ghosted", "revisit"]) {
        assert.equal(assertLeadTransition(from, to), to);
      }
    }
  });

  await t.test("lets a ghosted Lead come back", () => {
    assert.equal(assertLeadTransition("ghosted", "replied"), "replied");
  });

  await t.test("lets an offer be turned down or timed out", () => {
    assert.equal(assertLeadTransition("offer", "declined"), "declined");
    assert.equal(assertLeadTransition("offer", "revisit"), "revisit");
    assert.equal(assertLeadTransition("offer", "ghosted"), "ghosted");
  });

  await t.test("lets a revisit turn back into work", () => {
    assert.equal(assertLeadTransition("revisit", "drafted"), "drafted");
    assert.equal(assertLeadTransition("revisit", "sent"), "sent");
    assert.equal(assertLeadTransition("revisit", "ghosted"), "ghosted");
    assert.equal(assertLeadTransition("revisit", "declined"), "declined");
  });

  await t.test("treats a status moved to itself as a no-op", () => {
    assert.equal(assertLeadTransition("sent", "sent"), "sent");
  });

  await t.test("refuses a jump that skips the pipeline and names the legal set", () => {
    assert.throws(
      () => assertLeadTransition("sourced", "offer"),
      /illegal lead status transition: sourced → offer \(legal from sourced: drafted, declined, ghosted, revisit\)/,
    );
    assert.throws(
      () => assertLeadTransition("offer", "sent"),
      /illegal lead status transition: offer → sent \(legal from offer: declined, revisit, ghosted\)/,
    );
    assert.throws(
      () => assertLeadTransition("declined", "sourced"),
      /illegal lead status transition: declined → sourced \(legal from declined: none — terminal\)/,
    );
  });

  await t.test("refuses a status it does not know and names the statuses it does", () => {
    assert.throws(
      () => assertLeadTransition("sourced", "delivered"),
      /unknown lead status: delivered \(known: sourced, drafted, sent, replied, call, trial, offer, declined, revisit, ghosted\)/,
    );
    assert.throws(() => assertLeadTransition("pending", "sent"), /unknown lead status: pending/);
  });
});

test("research status machine", async (t) => {
  await t.test("names the three research states", () => {
    assert.deepEqual(RESEARCH_STATUSES, ["untriaged", "researched", "parked"]);
  });

  await t.test("walks untriaged to researched to parked and back", () => {
    assert.equal(assertResearchTransition("untriaged", "researched"), "researched");
    assert.equal(assertResearchTransition("researched", "parked"), "parked");
    assert.equal(assertResearchTransition("parked", "researched"), "researched");
    assert.equal(assertResearchTransition("researched", "untriaged"), "untriaged");
  });

  await t.test("lets a Company be parked without research", () => {
    assert.equal(assertResearchTransition("untriaged", "parked"), "parked");
    assert.equal(assertResearchTransition("parked", "untriaged"), "untriaged");
  });

  await t.test("names the legal set from every state", () => {
    assert.deepEqual(legalResearchTransitions("untriaged"), ["researched", "parked"]);
    assert.deepEqual(legalResearchTransitions("researched"), ["untriaged", "parked"]);
    assert.deepEqual(legalResearchTransitions("parked"), ["untriaged", "researched"]);
  });

  await t.test("treats a state moved to itself as a no-op", () => {
    assert.equal(assertResearchTransition("parked", "parked"), "parked");
  });

  await t.test("refuses a status it does not know and names the legal set", () => {
    assert.throws(
      () => assertResearchTransition("untriaged", "done"),
      /unknown research status: done \(known: untriaged, researched, parked\)/,
    );
    assert.throws(() => assertResearchTransition("lead", "parked"), /unknown research status: lead/);
  });
});

test("v1 to v2 migration", async (t) => {
  const v1 = {
    version: 1,
    updatedAt: "2026-10-26T04:48:30.726Z",
    companies: {
      acme: {
        slug: "acme",
        name: "Acme",
        website: "https://acme.example",
        batch: "S21",
        batchYear: 2021,
        teamSize: 4,
        stage: "Seed",
        location: "Pune, India",
        researchStatus: "parked",
        hiring: { ats: "greenhouse", boardId: "acme", roles: [{ title: "Founding Engineer" }] },
        sources: [{ source: "yc", url: "https://www.ycombinator.com/companies/acme", fetchedAt: "2026-10-01" }],
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
      quill: {
        slug: "quill-labs",
        name: "Quill",
        website: "https://quill.example",
        batch: "S21",
        teamSize: 90,
        sources: [],
      },
    },
    outreach: {
      acme: { stage: "sent", channel: "email", notes: "discarded, not reinterpreted" },
      quill: { stage: "sourced", channel: null, notes: "" },
    },
  };

  await t.test("bumps the version and stamps every Company untriaged", () => {
    const { db, migrated } = migrateDb(v1);
    assert.equal(migrated, true);
    assert.equal(db.version, DB_VERSION);
    assert.equal(db.companies.acme.researchStatus, "parked");
    assert.equal(db.companies.quill.researchStatus, "untriaged");
  });

  await t.test("keeps every Company fact intact", () => {
    const { db } = migrateDb(v1);
    const acme = db.companies.acme;
    assert.equal(acme.name, "Acme");
    assert.equal(acme.website, "https://acme.example");
    assert.equal(acme.batchYear, 2021);
    assert.equal(acme.teamSize, 4);
    assert.equal(acme.stage, "Seed");
    assert.equal(acme.location, "Pune, India");
    assert.equal(acme.hiring.boardId, "acme");
    assert.equal(acme.sources[0].url, "https://www.ycombinator.com/companies/acme");
    assert.equal(acme.createdAt, "2026-10-01T00:00:00.000Z");
  });

  await t.test("discards the v0 outreach map", () => {
    const { db } = migrateDb(v1);
    assert.equal(db.outreach, undefined);
  });

  await t.test("treats the map key as the canonical slug", () => {
    const { db } = migrateDb(v1);
    assert.equal(db.companies.quill.slug, "quill");
  });

  await t.test("starts People and Leads empty", () => {
    const { db } = migrateDb(v1);
    assert.deepEqual(db.people, {});
    assert.deepEqual(db.leads, {});
  });

  await t.test("is idempotent: a second migration changes nothing", () => {
    const first = migrateDb(v1);
    const second = migrateDb(first.db);
    assert.equal(second.migrated, false);
    assert.deepEqual(second.db, first.db);
  });

  await t.test("passes a version 2 file through untouched", () => {
    const v2 = { version: 2, companies: {}, people: {}, leads: {} };
    const { db, migrated } = migrateDb(v2);
    assert.equal(migrated, false);
    assert.equal(db, v2);
  });

  await t.test("treats a missing file as an empty version 2 corpus", () => {
    const { db, migrated } = migrateDb();
    assert.equal(migrated, true);
    assert.equal(db.version, DB_VERSION);
    assert.deepEqual(db.companies, {});
    assert.deepEqual(db.people, {});
    assert.deepEqual(db.leads, {});
  });
});

test("Leads list filtering", async (t) => {
  await t.test("returns every Lead sorted by company batch, then company, then person", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads })), [
      "northwind-ai--priya-sharma",
      "quill--rahul-verma",
      "zephyr--meera-iyer",
    ]);
  });

  await t.test("joins the person and the company onto each Lead", () => {
    const row = selectLeads({ companies, people, leads })[0];
    assert.equal(row.status, "sent");
    assert.equal(row.person.name, "Priya Sharma");
    assert.equal(row.person.role, "Founder");
    assert.equal(row.company.name, "Northwind AI");
    assert.equal(row.company.batch, "W24");
    assert.equal(row.company.researchStatus, "researched");
  });

  await t.test("filters by status", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { status: "sent" })), [
      "northwind-ai--priya-sharma",
    ]);
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { status: "sourced" })), [
      "quill--rahul-verma",
      "zephyr--meera-iyer",
    ]);
  });

  await t.test("searches the person name", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { q: "PRIYA" })), [
      "northwind-ai--priya-sharma",
    ]);
  });

  await t.test("searches the company name", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { q: "quill" })), ["quill--rahul-verma"]);
  });

  await t.test("searches the location", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { q: "pune" })), ["zephyr--meera-iyer"]);
  });

  await t.test("searches the batch", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { q: "s21" })), [
      "quill--rahul-verma",
      "zephyr--meera-iyer",
    ]);
  });

  await t.test("filters to Leads whose company has open roles", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { hasRoles: true })), [
      "northwind-ai--priya-sharma",
    ]);
  });

  await t.test("filters by source", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { source: "yc" })), [
      "northwind-ai--priya-sharma",
    ]);
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { source: "ats:ashby" })), [
      "quill--rahul-verma",
    ]);
  });

  await t.test("combines filters", () => {
    assert.deepEqual(
      leadIds(selectLeads({ companies, people, leads }, { status: "sourced", hasRoles: true })),
      [],
    );
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { status: "sourced", q: "pune" })), [
      "zephyr--meera-iyer",
    ]);
  });

  await t.test("applies a limit after sorting", () => {
    assert.deepEqual(leadIds(selectLeads({ companies, people, leads }, { limit: 2 })), [
      "northwind-ai--priya-sharma",
      "quill--rahul-verma",
    ]);
  });

  await t.test("returns an empty list for an empty corpus", () => {
    assert.deepEqual(selectLeads({ companies: {}, people: {}, leads: {} }), []);
    assert.deepEqual(selectLeads(), []);
  });
});
