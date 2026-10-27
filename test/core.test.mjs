import test from "node:test";
import assert from "node:assert/strict";

import { slugify, domainOf, findByDomain, slugForCompany, selectLeads } from "../lib/core.mjs";

/**
 * Characterising tests for the domain core. Every case pins behaviour that
 * already existed in store.mjs before the seam was extracted, so a later
 * refactor can move code without changing what the app or CLI show.
 *
 * Fixtures are invented (Acme, Northwind, Quill, Zephyr). Real lead data never
 * enters git, and v0's company-as-lead shape is deliberately frozen here until
 * the v1 tickets separate Company from Lead.
 */

const company = (overrides) => ({
  slug: overrides.slug,
  name: overrides.name,
  website: overrides.website ?? null,
  batch: overrides.batch ?? null,
  batchYear: overrides.batchYear ?? 0,
  batchSeason: overrides.batchSeason ?? "",
  teamSize: overrides.teamSize ?? null,
  location: overrides.location ?? null,
  hiring: overrides.hiring ?? null,
  sources: overrides.sources ?? [],
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
    sources: [{ source: "probe", url: "https://zephyr.example" }],
  }),
  acme: company({
    slug: "acme",
    name: "Acme",
    website: "acme.example",
    teamSize: 4,
    location: "Pune",
    sources: [{ source: "probe", url: "https://acme.example" }],
  }),
};

const outreach = {
  "northwind-ai": { stage: "sent", channel: "email" },
  quill: { stage: "sourced" },
  zephyr: { stage: "sourced" },
};

const slugs = (rows) => rows.map((r) => r.slug);

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

test("list filtering", async (t) => {
  await t.test("returns every lead sorted by batch year then name", () => {
    assert.deepEqual(slugs(selectLeads({ companies, outreach })), ["northwind-ai", "quill", "zephyr", "acme"]);
  });

  await t.test("merges outreach and defaults a missing row to sourced", () => {
    const rows = selectLeads({ companies, outreach });
    const acme = rows.find((r) => r.slug === "acme");
    assert.deepEqual(acme.outreach, { stage: "sourced" });
    assert.equal(rows.find((r) => r.slug === "northwind-ai").outreach.stage, "sent");
  });

  await t.test("filters by stage", () => {
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { stage: "sent" })), ["northwind-ai"]);
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { stage: "sourced" })), ["quill", "zephyr", "acme"]);
  });

  await t.test("filters to leads with open roles", () => {
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { hasRoles: true })), ["northwind-ai"]);
  });

  await t.test("searches name, location, batch and website case-insensitively", () => {
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { q: "india" })), ["northwind-ai", "quill", "zephyr"]);
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { q: "QUILL" })), ["quill"]);
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { q: "s21" })), ["quill", "zephyr"]);
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { q: "quill.example" })), ["quill"]);
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { q: "no such lead" })), []);
  });

  await t.test("filters by source", () => {
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { source: "yc" })), ["northwind-ai"]);
  });

  await t.test("combines filters", () => {
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { stage: "sourced", hasRoles: true })), []);
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { stage: "sourced", q: "pune" })), ["zephyr", "acme"]);
  });

  await t.test("applies a limit after sorting", () => {
    assert.deepEqual(slugs(selectLeads({ companies, outreach }, { limit: 2 })), ["northwind-ai", "quill"]);
  });

  await t.test("returns an empty list for an empty corpus", () => {
    assert.deepEqual(selectLeads({ companies: {}, outreach: {} }), []);
    assert.deepEqual(selectLeads(), []);
  });
});
