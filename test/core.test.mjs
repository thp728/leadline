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
  applyLeadTransition,
  ATTEMPT_CHANNELS,
  ATTEMPT_KINDS,
  LADDER_DAYS,
  ATTEMPT_CAP,
  addDays,
  isIsoDate,
  createAttempt,
  sortAttempts,
  attemptsNewestFirst,
  defaultAttemptKind,
  ladderSuggestion,
  planAttempt,
  migrateDb,
  selectLeads,
  daysBetween,
  isoDay,
  morningBuckets,
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

const attempt = (date, kind = "first", channel = "email", note) => ({
  date,
  kind,
  channel,
  ...(note ? { note } : {}),
});

test("the ladder", async (t) => {
  await t.test("names the cadence as constants, not configuration", () => {
    assert.deepEqual(LADDER_DAYS, [4, 7]);
    assert.equal(ATTEMPT_CAP, 3);
  });

  await t.test("suggests nothing before the first Attempt", () => {
    const s = ladderSuggestion({ status: "sourced", attempts: [] });
    assert.equal(s.stopped, false);
    assert.equal(s.count, 0);
    assert.equal(s.nextTouch, null);
    assert.equal(s.status, null);
  });

  const cases = [
    {
      name: "suggests +4 days after the first Attempt",
      attempts: [attempt("2026-10-20")],
      nextTouch: "2026-10-24",
      days: 4,
      status: null,
    },
    {
      name: "suggests +7 days after the second Attempt",
      attempts: [attempt("2026-10-20"), attempt("2026-10-24", "followup")],
      nextTouch: "2026-10-31",
      days: 7,
      status: null,
    },
    {
      name: "suggests ghosted after the third Attempt and sets no next date",
      attempts: [attempt("2026-10-20"), attempt("2026-10-24", "followup"), attempt("2026-10-31", "followup")],
      nextTouch: null,
      days: null,
      status: "ghosted",
    },
    {
      name: "keeps suggesting ghosted after a fourth Attempt",
      attempts: [
        attempt("2026-10-20"),
        attempt("2026-10-24", "followup"),
        attempt("2026-10-31", "followup"),
        attempt("2026-11-04", "followup"),
      ],
      nextTouch: null,
      days: null,
      status: "ghosted",
    },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      const s = ladderSuggestion({ status: "sent", attempts: c.attempts });
      assert.equal(s.stopped, false);
      assert.equal(s.nextTouch, c.nextTouch);
      assert.equal(s.days, c.days);
      assert.equal(s.status, c.status);
      assert.equal(s.count, c.attempts.length);
    });
  }

  await t.test("counts from the latest Attempt, not the first", () => {
    const s = ladderSuggestion({ status: "sent", attempts: [attempt("2026-09-01"), attempt("2026-10-20", "followup")] });
    assert.equal(s.nextTouch, "2026-10-27");
  });

  await t.test("stops after a reply or any status past sent", () => {
    for (const status of ["replied", "call", "trial", "offer", "declined", "ghosted", "revisit"]) {
      const s = ladderSuggestion({ status, attempts: [attempt("2026-10-20")] });
      assert.equal(s.stopped, true, `${status} should stop the ladder`);
      assert.equal(s.nextTouch, null);
      assert.equal(s.status, null);
    }
  });

  await t.test("keeps laddering while nothing has come back", () => {
    for (const status of ["sourced", "drafted", "sent"]) {
      const s = ladderSuggestion({ status, attempts: [attempt("2026-10-20")] });
      assert.equal(s.stopped, false, `${status} is still on the ladder`);
      assert.equal(s.nextTouch, "2026-10-24");
    }
  });
});

test("day arithmetic", async (t) => {
  await t.test("adds days within a month", () => {
    assert.equal(addDays("2026-10-20", 4), "2026-10-24");
    assert.equal(addDays("2026-10-24", 7), "2026-10-31");
  });

  await t.test("crosses a month and a year boundary", () => {
    assert.equal(addDays("2026-10-30", 4), "2026-11-03");
    assert.equal(addDays("2026-12-30", 7), "2027-01-06");
  });

  await t.test("refuses a day that does not exist", () => {
    assert.equal(isIsoDate("2026-02-30"), false);
    assert.throws(() => addDays("2026-02-30", 1), /not a date: 2026-02-30/);
    assert.equal(isIsoDate("2026-02-28"), true);
    assert.equal(isIsoDate("2026-2-8"), false);
    assert.equal(isIsoDate("2026-10-20T00:00:00.000Z"), false);
  });
});

test("recording an Attempt", async (t) => {
  await t.test("keeps a day, a channel, a kind and an optional one-line note", () => {
    assert.deepEqual(
      createAttempt(
        { date: "2026-10-20", channel: "email", kind: "first", note: "  Sent the teardown.\nAsked who owns it.  " },
        { today: "2026-10-27" },
      ),
      { date: "2026-10-20", channel: "email", kind: "first", note: "Sent the teardown. Asked who owns it." },
    );
  });

  await t.test("defaults the date to today", () => {
    assert.equal(createAttempt({ channel: "x", kind: "first" }, { today: "2026-10-27" }).date, "2026-10-27");
  });

  await t.test("omits an empty note rather than storing a blank", () => {
    const logged = createAttempt({ channel: "email", kind: "first", note: "   " }, { today: "2026-10-27" });
    assert.equal("note" in logged, false);
  });

  await t.test("defaults the kind from the history", () => {
    assert.equal(defaultAttemptKind([]), "first");
    assert.equal(defaultAttemptKind([attempt("2026-10-20")]), "followup");
  });

  await t.test("refuses an Attempt dated in the future", () => {
    assert.throws(
      () => createAttempt({ date: "2026-10-28", channel: "email", kind: "first" }, { today: "2026-10-27" }),
      /attempt date cannot be in the future: 2026-10-28/,
    );
  });

  await t.test("refuses a kind it does not know and names the set", () => {
    assert.deepEqual(ATTEMPT_KINDS, ["first", "followup"]);
    assert.deepEqual(ATTEMPT_CHANNELS, ["email", "linkedin", "x", "other"]);
    assert.throws(
      () => createAttempt({ channel: "email", kind: "cold" }, { today: "2026-10-27" }),
      /unknown attempt kind: cold \(known: first, followup\)/,
    );
  });

  await t.test("refuses a channel it does not know and names the set", () => {
    assert.throws(
      () => createAttempt({ channel: "carrier-pigeon", kind: "first" }, { today: "2026-10-27" }),
      /unknown attempt channel: carrier-pigeon \(known: email, linkedin, x, other\)/,
    );
    assert.throws(
      () => createAttempt({ kind: "first" }, { today: "2026-10-27" }),
      /unknown attempt channel: \(none\)/,
    );
  });
});

test("Attempt history order", async (t) => {
  const attempts = [attempt("2026-10-24", "followup"), attempt("2026-10-20"), attempt("2026-10-20", "followup")];
  const namer = (a) => `${a.date} ${a.kind}`;

  await t.test("stores the oldest Attempt first", () => {
    assert.deepEqual(sortAttempts(attempts).map(namer), [
      "2026-10-20 first",
      "2026-10-20 followup",
      "2026-10-24 followup",
    ]);
  });

  await t.test("renders the newest Attempt first, including same-day ones", () => {
    assert.deepEqual(attemptsNewestFirst(attempts).map(namer), [
      "2026-10-24 followup",
      "2026-10-20 followup",
      "2026-10-20 first",
    ]);
  });

  await t.test("leaves the input untouched", () => {
    const before = JSON.stringify(attempts);
    sortAttempts(attempts);
    attemptsNewestFirst(attempts);
    assert.equal(JSON.stringify(attempts), before);
  });
});

test("Lead dates follow the Attempt and the status", async (t) => {
  const sent = {
    status: "sent",
    attempts: [],
    nextTouch: "2026-11-01",
    nextTouchOverride: false,
    revisitAfter: null,
  };

  await t.test("a reply clears the suggested next date and any override", () => {
    const next = applyLeadTransition({ ...sent, nextTouchOverride: true }, "replied");
    assert.equal(next.status, "replied");
    assert.equal(next.nextTouch, null);
    assert.equal(next.nextTouchOverride, false);
  });

  await t.test("ghosting or declining clears the next date", () => {
    for (const status of ["ghosted", "declined"]) {
      const next = applyLeadTransition(sent, status);
      assert.equal(next.nextTouch, null, `${status} should clear the date`);
      assert.equal(next.nextTouchOverride, false);
    }
  });

  await t.test("a revisit needs a date", () => {
    assert.throws(() => applyLeadTransition(sent, "revisit"), /a revisit needs a date/);
    assert.throws(
      () => applyLeadTransition(sent, "revisit", { revisitAfter: "next week" }),
      /revisit date must be YYYY-MM-DD, got: next week/,
    );
  });

  await t.test("a timed revisit carries its date and no touch date", () => {
    const next = applyLeadTransition(sent, "revisit", { revisitAfter: "2026-12-01" });
    assert.equal(next.status, "revisit");
    assert.equal(next.revisitAfter, "2026-12-01");
    assert.equal(next.nextTouch, null);
    assert.equal(next.nextTouchOverride, false);
  });

  await t.test("changing the revisit date keeps it timed", () => {
    const revisit = { ...sent, status: "revisit", revisitAfter: "2026-12-01", nextTouch: null };
    assert.equal(applyLeadTransition(revisit, "revisit", { revisitAfter: "2027-01-05" }).revisitAfter, "2027-01-05");
    assert.equal(applyLeadTransition(revisit, "revisit").revisitAfter, "2026-12-01");
  });

  await t.test("leaving revisit clears the revisit date", () => {
    const revisit = { ...sent, status: "revisit", revisitAfter: "2026-12-01", nextTouch: null };
    assert.equal(applyLeadTransition(revisit, "drafted").revisitAfter, null);
    assert.equal(applyLeadTransition(revisit, "sent").revisitAfter, null);
  });

  await t.test("refuses an illegal jump and names the legal set", () => {
    assert.throws(
      () => applyLeadTransition({ status: "sourced" }, "replied"),
      /illegal lead status transition: sourced → replied \(legal from sourced: drafted, declined, ghosted, revisit\)/,
    );
  });
});

test("planning an Attempt", async (t) => {
  const sent = { status: "sent", attempts: [], nextTouch: null, nextTouchOverride: false };
  const first = { date: "2026-10-20", channel: "email", kind: "first" };
  const at = { today: "2026-10-27" };

  await t.test("suggests a date without applying it", () => {
    const plan = planAttempt(sent, first, at);
    assert.equal(plan.suggestion.nextTouch, "2026-10-24");
    assert.equal(plan.nextTouch, null);
    assert.equal(plan.accepted, false);
  });

  await t.test("applies the suggestion only when accepted", () => {
    const plan = planAttempt(sent, first, { ...at, accept: true });
    assert.equal(plan.accepted, true);
    assert.equal(plan.nextTouch, "2026-10-24");
    assert.equal(plan.nextTouchOverride, false);
  });

  await t.test("leaves an overridden date alone even when accepted", () => {
    const overridden = { ...sent, nextTouch: "2026-11-15", nextTouchOverride: true };
    const plan = planAttempt(overridden, first, { ...at, accept: true });
    assert.equal(plan.accepted, false);
    assert.equal(plan.nextTouch, "2026-11-15");
    assert.equal(plan.nextTouchOverride, true);
  });

  await t.test("leaves the date alone when the ladder is stopped", () => {
    const replied = { ...sent, status: "replied", nextTouch: "2026-11-01" };
    const plan = planAttempt(replied, first, { ...at, accept: true });
    assert.equal(plan.accepted, false);
    assert.equal(plan.nextTouch, "2026-11-01");
  });

  await t.test("keeps a legacy date whose override flag predates the field", () => {
    const legacy = { status: "sent", attempts: [], nextTouch: "2026-11-15" };
    const plan = planAttempt(legacy, first, { ...at, accept: true });
    assert.equal(plan.nextTouch, "2026-11-15");
    assert.equal(plan.nextTouchOverride, true);
  });

  await t.test("clears the date when the third Attempt exhausts the ladder", () => {
    const exhausted = {
      ...sent,
      attempts: [attempt("2026-10-01"), attempt("2026-10-05", "followup")],
      nextTouch: "2026-10-12",
    };
    const plan = planAttempt(exhausted, { date: "2026-10-09", channel: "email", kind: "followup" }, { ...at, accept: true });
    assert.equal(plan.suggestion.status, "ghosted");
    assert.equal(plan.nextTouch, null);
    assert.equal(plan.attempts.length, 3);
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

test("day counts between calendar days", async (t) => {
  const cases = [
    { name: "counts the same day as zero", from: "2026-10-28", to: "2026-10-28", expected: 0 },
    { name: "counts yesterday to today as one", from: "2026-10-27", to: "2026-10-28", expected: 1 },
    { name: "counts a future day as negative", from: "2026-10-28", to: "2026-10-27", expected: -1 },
    { name: "crosses a month boundary", from: "2026-10-28", to: "2026-11-04", expected: 7 },
    { name: "crosses a year boundary", from: "2026-12-30", to: "2027-01-06", expected: 7 },
    { name: "counts the leap day", from: "2028-02-28", to: "2028-03-01", expected: 2 },
    { name: "is unmoved by a daylight-boundary day", from: "2026-03-07", to: "2026-03-09", expected: 2 },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      assert.equal(daysBetween(c.from, c.to), c.expected);
    });
  }

  await t.test("refuses a day that is not a calendar date", () => {
    assert.throws(() => daysBetween("2026-10-28", "tomorrow"), /not a date: tomorrow/);
    assert.throws(() => daysBetween("2026-02-30", "2026-03-01"), /not a date: 2026-02-30/);
  });
});

test("the morning screen", async (t) => {
  const today = "2026-10-28";
  const at = { today };

  const oneLead = (companySlug, name, spec) => {
    const l = lead(companySlug, name, spec);
    return {
      companies: { [companySlug]: company({ slug: companySlug, name: "Acme", batchYear: 2025 }) },
      people: { [l.leadId]: person(companySlug, name) },
      leads: { [l.leadId]: l },
    };
  };

  const bucketIdFor = (corpus) => {
    const { buckets } = morningBuckets(corpus, at);
    const [only] = buckets.flatMap((b) => b.rows.filter((r) => r.leadId)).map((r) => r.leadId);
    return buckets.find((b) => b.rows.some((r) => r.leadId === only))?.id ?? null;
  };

  await t.test("names the four buckets in priority order", () => {
    const { buckets } = morningBuckets({ companies: {}, people: {}, leads: {} }, at);
    assert.deepEqual(buckets.map((b) => b.id), ["due", "waiting", "research", "backlog"]);
    assert.deepEqual(buckets.map((b) => b.label), ["Due", "Waiting", "No human yet", "Backlog"]);
  });

  const cases = [
    { name: "sent with a next touch of today is due", spec: { status: "sent", nextTouch: today }, expected: "due" },
    {
      name: "sent with a next touch in the past is due",
      spec: { status: "sent", nextTouch: "2026-10-20" },
      expected: "due",
    },
    {
      name: "sent with a next touch tomorrow is not due",
      spec: { status: "sent", nextTouch: "2026-10-29" },
      expected: null,
    },
    { name: "sent with no next date is waiting", spec: { status: "sent" }, expected: "waiting" },
    {
      name: "drafted with an arrived date is due",
      spec: { status: "drafted", nextTouch: "2026-10-20" },
      expected: "due",
    },
    {
      name: "a live offer with an arrived date is due",
      spec: { status: "offer", nextTouch: "2026-10-20" },
      expected: "due",
    },
    {
      name: "a revisit whose date arrived is due",
      spec: { status: "revisit", revisitAfter: "2026-10-20" },
      expected: "due",
    },
    {
      name: "a revisit dated today is due",
      spec: { status: "revisit", revisitAfter: today },
      expected: "due",
    },
    {
      name: "a revisit dated tomorrow is not due",
      spec: { status: "revisit", revisitAfter: "2026-10-29" },
      expected: null,
    },
    {
      name: "a ghosted Lead is not due even with a date",
      spec: { status: "ghosted", nextTouch: "2026-10-01" },
      expected: null,
    },
    {
      name: "a declined Lead is not due even with a date",
      spec: { status: "declined", nextTouch: "2026-10-01" },
      expected: null,
    },
    { name: "sourced with nothing sent is backlog", spec: { status: "sourced" }, expected: "backlog" },
    {
      name: "sourced with an arrived date is due, not backlog",
      spec: { status: "sourced", nextTouch: "2026-10-01" },
      expected: "due",
    },
    {
      name: "drafted with a future date is in no bucket",
      spec: { status: "drafted", nextTouch: "2026-11-01" },
      expected: null,
    },
    { name: "replied with no date is in no bucket", spec: { status: "replied" }, expected: null },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      assert.equal(bucketIdFor(oneLead("acme", "Case Person", c.spec)), c.expected);
    });
  }

  const planted = () => {
    const companies = {
      inkwell: company({ slug: "inkwell", name: "Inkwell", batch: "W26", batchYear: 2026, researchStatus: "untriaged" }),
      northwind: company({ slug: "northwind", name: "Northwind", batch: "S24", batchYear: 2024, researchStatus: "untriaged" }),
      bright: company({ slug: "bright", name: "Bright", batch: "S23", batchYear: 2023, researchStatus: "researched" }),
      zephyr: company({ slug: "zephyr", name: "Zephyr", batch: "S21", batchYear: 2021, researchStatus: "parked" }),
      delta: company({ slug: "delta", name: "Delta", batch: "S22", batchYear: 2022, researchStatus: "researched" }),
      quill: company({ slug: "quill", name: "Quill", batch: "W22", batchYear: 2022, researchStatus: "researched" }),
    };
    const names = {
      "delta--overdue": "Delta Overdue",
      "delta--revisit": "Delta Revisit",
      "delta--today": "Delta Today",
      "delta--sourced": "Delta Sourced",
      "quill--ana": "Quill Ana",
      "quill--bo": "Quill Bo",
      "quill--future": "Quill Future",
      "quill--sourced": "Quill Sourced",
      "acme--sourced": "Acme Sourced",
    };
    const people = {};
    for (const [id, name] of Object.entries(names)) {
      const [companySlug, personSlug] = id.split("--");
      people[id] = { ...person(companySlug, name), personId: id };
    }

    const leads = {
      "delta--overdue": { ...lead("delta", "Delta Overdue", { status: "sent", nextTouch: "2026-10-20" }), leadId: "delta--overdue", personId: "delta--overdue" },
      "delta--revisit": { ...lead("delta", "Delta Revisit", { status: "revisit", revisitAfter: "2026-10-27" }), leadId: "delta--revisit", personId: "delta--revisit" },
      "delta--today": { ...lead("delta", "Delta Today", { status: "sent", nextTouch: today }), leadId: "delta--today", personId: "delta--today" },
      "delta--sourced": { ...lead("delta", "Delta Sourced"), leadId: "delta--sourced", personId: "delta--sourced" },
      "quill--ana": {
        ...lead("quill", "Quill Ana", { status: "sent", attempts: [attempt("2026-10-16")] }),
        leadId: "quill--ana",
        personId: "quill--ana",
      },
      "quill--bo": {
        ...lead("quill", "Quill Bo", { status: "sent", attempts: [attempt("2026-10-25")] }),
        leadId: "quill--bo",
        personId: "quill--bo",
      },
      "quill--future": {
        ...lead("quill", "Quill Future", { status: "drafted", nextTouch: "2026-11-01" }),
        leadId: "quill--future",
        personId: "quill--future",
      },
      "quill--sourced": {
        ...lead("quill", "Quill Sourced"),
        leadId: "quill--sourced",
        personId: "quill--sourced",
      },
      "acme--sourced": {
        ...lead("acme", "Acme Sourced"),
        leadId: "acme--sourced",
        personId: "acme--sourced",
        companySlug: "acme",
      },
    };
    companies.acme = company({ slug: "acme", name: "Acme", batch: "W23", batchYear: 2023, researchStatus: "researched" });

    return { companies, people, leads };
  };

  await t.test("puts the most overdue Lead first", () => {
    const { buckets } = morningBuckets(planted(), at);
    const due = buckets.find((b) => b.id === "due");
    assert.deepEqual(due.rows.map((r) => r.leadId), ["delta--overdue", "delta--revisit", "delta--today"]);
  });

  await t.test("puts the Lead waiting longest first", () => {
    const { buckets } = morningBuckets(planted(), at);
    const waiting = buckets.find((b) => b.id === "waiting");
    assert.deepEqual(waiting.rows.map((r) => r.leadId), ["quill--ana", "quill--bo"]);
  });

  await t.test("queues research untriaged first and newest batch first", () => {
    const { buckets } = morningBuckets(planted(), at);
    const research = buckets.find((b) => b.id === "research");
    assert.deepEqual(research.rows.map((r) => r.slug), ["inkwell", "northwind", "bright", "zephyr"]);
  });

  await t.test("lists the backlog newest batch first", () => {
    const { buckets } = morningBuckets(planted(), at);
    const backlog = buckets.find((b) => b.id === "backlog");
    assert.deepEqual(backlog.rows.map((r) => r.leadId), ["acme--sourced", "delta--sourced", "quill--sourced"]);
  });

  await t.test("counts every bucket and puts no Lead in two", () => {
    const { buckets } = morningBuckets(planted(), at);
    for (const bucket of buckets) assert.equal(bucket.count, bucket.rows.length);
    const ids = buckets.flatMap((b) => b.rows.map((r) => r.leadId).filter(Boolean));
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      buckets.map((b) => b.count),
      [3, 2, 4, 3],
    );
  });

  await t.test("counts a Company with no Leads as research but one with a declined Lead as not", () => {
    const corpus = {
      companies: {
        empty: company({ slug: "empty", name: "Empty" }),
        closed: company({ slug: "closed", name: "Closed" }),
      },
      people: {},
      leads: {},
    };
    const declined = lead("closed", "Gone Person", { status: "declined" });
    corpus.people[declined.leadId] = person("closed", "Gone Person");
    corpus.leads[declined.leadId] = declined;

    const research = morningBuckets(corpus, at).buckets.find((b) => b.id === "research");
    assert.deepEqual(research.rows.map((r) => r.slug), ["empty"]);
  });

  await t.test("says what to do about every empty bucket", () => {
    const { buckets, today: echoed, counts } = morningBuckets({ companies: {}, people: {}, leads: {} }, at);
    assert.equal(echoed, today);
    assert.deepEqual(counts, { companies: 0, leads: 0 });
    for (const bucket of buckets) {
      assert.equal(bucket.count, 0);
      assert.deepEqual(bucket.rows, []);
      assert.ok(bucket.note.length > 0, `${bucket.id} needs a note`);
      assert.ok(bucket.empty.length > 20, `${bucket.id} needs a next action`);
    }
  });

  await t.test("refuses to classify without a calendar day", () => {
    assert.throws(() => morningBuckets({}, {}), /morning buckets need today/);
    assert.throws(() => morningBuckets({}, { today: "Wednesday" }), /morning buckets need today/);
  });

  await t.test("takes the day from the local calendar across a daylight boundary", () => {
    const springForward = new Date(2026, 2, 8, 1, 30);
    assert.equal(isoDay(springForward), "2026-03-08");

    const fallBack = new Date(2026, 10, 1, 23, 30);
    assert.equal(isoDay(fallBack), "2026-11-01");

    const localToday = isoDay(fallBack);
    const dueLead = lead("acme", "Due Person", { status: "sent", nextTouch: localToday });
    const nextLead = lead("acme", "Next Person", { status: "sent", nextTouch: addDays(localToday, 1) });
    const corpus = {
      companies: { acme: company({ slug: "acme", name: "Acme" }) },
      people: {
        [dueLead.leadId]: person("acme", "Due Person"),
        [nextLead.leadId]: person("acme", "Next Person"),
      },
      leads: { [dueLead.leadId]: dueLead, [nextLead.leadId]: nextLead },
    };

    const due = morningBuckets(corpus, { today: localToday }).buckets.find((b) => b.id === "due");
    assert.deepEqual(due.rows.map((r) => r.person.name), ["Due Person"]);
  });
});
