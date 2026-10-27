/**
 * Build a realistic mock corpus for UI work. Pure: no filesystem, no network,
 * and dates are relative to the `today` you pass in, so the same day seeds the
 * same file.
 *
 * The point is coverage, not prettiness. Between the fixture companies below
 * there is every research state, every Lead status, a company with no Leads, a
 * company with three, duplicate names, a `-2` id, long and Unicode strings,
 * missing fields, stale hiring data, due dates in the past, today and the
 * future, and every Attempt shape the model allows.
 *
 * This module feeds scripts/mock.mjs. It never reads or writes the real data/.
 */

import { slugify, leadIdFor } from "../lib/core.mjs";

const DAY = 86400000;

function batchFacts(batch) {
  const m = /^([WS])(\d{2})$/.exec(batch || "");
  if (!m) return { batchYear: 0, batchSeason: "" };
  return { batchYear: 2000 + Number(m[2]), batchSeason: m[1] === "W" ? "winter" : "summer" };
}

export function buildMockDb({ today = new Date() } = {}) {
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = (offset) => new Date(base.getTime() + offset * DAY).toISOString().slice(0, 10);
  const stamp = (offset, hour = 9) => {
    const d = new Date(base.getTime() + offset * DAY);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const companies = {};
  const people = {};
  const leads = {};

  const boards = {
    greenhouse: (board) => `https://boards.greenhouse.io/${board}`,
    ashby: (board) => `https://jobs.ashbyhq.com/${board}`,
    lever: (board) => `https://jobs.lever.co/${board}`,
    workable: (board) => `https://apply.workable.com/${board}`,
  };

  function hiring(ats, board, roles, { fetched = -2, foundOn } = {}) {
    const canonical = boards[ats](board);
    return {
      ats,
      boardId: board,
      foundOn: foundOn || canonical,
      roles: roles.map((r, i) => ({
        title: r.title,
        location: r.location ?? null,
        url: r.url || `${canonical}/${ats === "greenhouse" ? `jobs/${4100000 + i}` : `postings/${i + 1}`}`,
        publishedAt: stamp(r.published ?? -20),
      })),
      fetchedAt: stamp(fetched),
    };
  }

  function company(spec) {
    const slug = spec.slug || slugify(spec.name);
    companies[slug] = {
      slug,
      name: spec.name,
      website: spec.website ?? null,
      batch: spec.batch ?? null,
      ...batchFacts(spec.batch),
      teamSize: spec.teamSize ?? null,
      stage: spec.stage ?? null,
      location: spec.location ?? null,
      regions: spec.regions ?? ["India", "South Asia"],
      oneLiner: spec.oneLiner ?? null,
      tags: spec.tags ?? [],
      researchStatus: spec.researchStatus ?? "untriaged",
      hiring: spec.hiring ?? null,
      sources: spec.sources,
      lastProbedAt: spec.lastProbedAt ?? null,
      probeLog: spec.probeLog ?? [],
      notes: spec.notes ?? "",
      createdAt: stamp(spec.added ?? -120),
      updatedAt: stamp(spec.updated ?? -1),
    };
    return slug;
  }

  /** Naming a person is what creates the Lead; identity is derived exactly once. */
  function lead(companySlug, personSpec, leadSpec) {
    const id = leadIdFor(companySlug, personSpec.name, Object.keys(leads));
    const email = personSpec.email ?? null;
    const verified = Boolean(email && personSpec.verified);

    people[id] = {
      personId: id,
      companySlug,
      name: personSpec.name,
      role: personSpec.role ?? null,
      handle: personSpec.handle ?? null,
      email,
      emailVerified: verified,
      contactSource: personSpec.source ?? null,
      sources: personSpec.source
        ? [{ source: "manual", url: personSpec.source, fetchedAt: stamp(personSpec.found ?? -30) }]
        : [],
      verifiedAt: verified ? stamp(personSpec.verifiedAt ?? -10) : null,
      createdAt: stamp(personSpec.added ?? -45),
    };

    leads[id] = {
      leadId: id,
      companySlug,
      personId: id,
      status: leadSpec.status,
      pitch: leadSpec.pitch ?? "",
      ask: leadSpec.ask ?? "conversation",
      attempts: (leadSpec.attempts ?? []).map((a) => ({
        date: day(a.day),
        channel: a.channel,
        kind: a.kind,
        ...(a.note ? { note: a.note } : {}),
      })),
      nextTouch: leadSpec.nextTouch === undefined || leadSpec.nextTouch === null ? null : day(leadSpec.nextTouch),
      nextTouchOverride: Boolean(leadSpec.nextTouchOverride),
      revisitAfter:
        leadSpec.revisitAfter === undefined || leadSpec.revisitAfter === null ? null : day(leadSpec.revisitAfter),
      proofLink: leadSpec.proofLink ?? null,
      notes: leadSpec.notes ?? "",
      createdAt: stamp(personSpec.added ?? -45),
      updatedAt: stamp(leadSpec.touched ?? -3),
    };
    return id;
  }

  const yc = (slug, fetched = -90) => ({
    source: "yc",
    url: `https://www.ycombinator.com/companies/${slug}`,
    fetchedAt: stamp(fetched),
  });
  const ats = (kind, url, fetched = -2) => ({ source: `ats:${kind}`, url, fetchedAt: stamp(fetched) });
  const probe = (url, fetched = -30) => ({ source: "probe", url, fetchedAt: stamp(fetched) });

  // Two Leads, one with a pitch and one with nothing but a name. Fresh hiring.
  company({
    name: "Kettle Labs",
    website: "https://kettlelabs.example",
    batch: "W23",
    teamSize: 24,
    stage: "Seed",
    location: "Bengaluru, India",
    oneLiner: "Usage-based billing for Indian SaaS.",
    tags: ["B2B", "SaaS", "Fintech"],
    researchStatus: "researched",
    hiring: hiring(
      "greenhouse",
      "kettlelabs",
      [
        { title: "Founding Engineer", location: "Bengaluru, India", published: -12 },
        { title: "Senior Product Designer", location: "Remote (India)", published: -30 },
        { title: "Customer Success Lead", location: "Bengaluru, India", published: -61 },
      ],
      { fetched: -2 },
    ),
    sources: [yc("kettle-labs"), ats("greenhouse", "https://boards.greenhouse.io/kettlelabs")],
    lastProbedAt: stamp(-2),
    probeLog: [
      { url: "https://kettlelabs.example", status: 200 },
      { url: "https://kettlelabs.example/careers", status: 200 },
    ],
    notes: "Growth is strong; two of the three roles are new this month.",
    added: -70,
    updated: -2,
  });
  lead(
    "kettle-labs",
    {
      name: "Ananya Rao",
      role: "Founder & CEO",
      handle: "@ananya",
      email: "ananya@kettlelabs.example",
      source: "https://kettlelabs.example/about",
      found: -20,
      added: -20,
    },
    {
      status: "drafted",
      pitch: "Billing reliability is a hiring constraint, not just a product one — I shipped usage metering at scale.",
      ask: "conversation",
      proofLink: "https://portfolio.example/case/billing",
      nextTouch: 2,
      notes: "Lead with the metering migration.",
      touched: -3,
    },
  );
  lead(
    "kettle-labs",
    { name: "Rohit Menon", role: "Founding Engineer", added: -40 },
    { status: "sourced", ask: "trial", touched: -40 },
  );

  // Untriaged research queue: nobody named yet, fresh roles.
  company({
    name: "Monsoon Pay",
    website: "https://monsoonpay.example",
    batch: "W24",
    teamSize: 18,
    stage: "Seed",
    location: "Mumbai, India",
    oneLiner: "UPI collections for small merchants.",
    tags: ["Fintech", "Payments"],
    researchStatus: "untriaged",
    hiring: hiring(
      "ashby",
      "monsoonpay",
      [
        { title: "Backend Engineer", location: "Mumbai, India", published: -7 },
        { title: "Risk Analyst", location: "Mumbai, India", published: -21 },
      ],
      { fetched: -5 },
    ),
    sources: [yc("monsoon-pay"), ats("ashby", "https://jobs.ashbyhq.com/monsoonpay", -5)],
    lastProbedAt: stamp(-5),
    probeLog: [{ url: "https://monsoonpay.example", status: 200 }],
    added: -60,
    updated: -5,
  });

  // Parked, no hiring, no human. The "come back later" shape.
  company({
    name: "Fernhill",
    website: "https://fernhill.example",
    batch: "S21",
    teamSize: 40,
    stage: "Series A",
    location: "Pune, India",
    oneLiner: "Compliance automation for exporters.",
    tags: ["B2B", "RegTech"],
    researchStatus: "parked",
    sources: [yc("fernhill"), probe("https://fernhill.example", -45)],
    lastProbedAt: stamp(-45),
    notes: "Parked: no open roles and the team is mid-reorg. Revisit after their Series B.",
    added: -200,
    updated: -45,
  });

  // A Lead that is due today, with one Attempt and an unverified email.
  company({
    name: "Tallycraft",
    website: "https://tallycraft.example",
    batch: "S22",
    teamSize: 9,
    stage: "Seed",
    location: "Hyderabad, India",
    oneLiner: "Bookkeeping that reads bank statements.",
    tags: ["Fintech", "SMB"],
    researchStatus: "researched",
    hiring: hiring("greenhouse", "tallycraft", [{ title: "Full-stack Engineer", location: "Hyderabad, India", published: -18 }], {
      fetched: -6,
    }),
    sources: [yc("tallycraft"), ats("greenhouse", "https://boards.greenhouse.io/tallycraft", -6)],
    lastProbedAt: stamp(-6),
    added: -95,
    updated: -6,
  });
  lead(
    "tallycraft",
    {
      name: "Priya Nair",
      role: "CTO",
      handle: "@priyanair",
      email: "priya@tallycraft.example",
      source: "https://tallycraft.example/team",
      found: -35,
      added: -35,
    },
    {
      status: "sent",
      pitch: "Your statement parser is the product; I have shipped the same pipeline for three banks.",
      proofLink: "https://portfolio.example/case/ledgers",
      attempts: [
        {
          day: -6,
          channel: "email",
          kind: "first",
          note: "Sent the ledger-reconciliation teardown; asked who owns the import path.",
        },
      ],
      nextTouch: 0,
      touched: -6,
    },
  );

  // A reply: the ladder stops, the date clears, the email is verified.
  company({
    name: "Blue Whale Freight",
    website: "https://bluewhalefreight.example",
    batch: "W21",
    teamSize: 55,
    stage: "Series A",
    location: "Chennai, India",
    oneLiner: "Container booking for mid-size exporters.",
    tags: ["Logistics", "B2B"],
    researchStatus: "untriaged",
    hiring: hiring(
      "lever",
      "bluewhalefreight",
      [
        { title: "Engineering Manager", location: "Chennai, India", published: -9 },
        { title: "Platform Engineer", location: "Remote (India)", published: -26 },
        { title: "Data Analyst", location: "Chennai, India", published: -40 },
      ],
      { fetched: -3 },
    ),
    sources: [yc("blue-whale-freight"), ats("lever", "https://jobs.lever.co/bluewhalefreight", -3)],
    lastProbedAt: stamp(-3),
    added: -300,
    updated: -3,
  });
  lead(
    "blue-whale-freight",
    {
      name: "Arjun Iyer",
      role: "VP Engineering",
      handle: "@arjun_iyer",
      email: "arjun@bluewhalefreight.example",
      verified: true,
      verifiedAt: -8,
      source: "https://bluewhalefreight.example/team",
      found: -50,
      added: -50,
    },
    {
      status: "replied",
      pitch: "You are rebuilding the booking engine; I have done the same migration twice.",
      ask: "trial",
      attempts: [
        { day: -14, channel: "linkedin", kind: "first", note: "Asked about the booking engine rewrite." },
        { day: -7, channel: "email", kind: "followup", note: "They replied: happy to talk after their release." },
      ],
      proofLink: "https://portfolio.example/case/booking-migration",
      notes: "They replied; wait for their release week.",
      touched: -7,
    },
  );

  // Three Leads at one Company: a call, a ghosted cap, and a -2 id collision.
  company({
    name: "Pillbox Health",
    website: "https://pillboxhealth.example",
    batch: "W22",
    teamSize: 32,
    stage: "Seed",
    location: "Delhi, India",
    oneLiner: "Pharmacy fulfilment for tier-2 cities.",
    tags: ["HealthTech", "Logistics"],
    researchStatus: "researched",
    hiring: null,
    sources: [yc("pillbox-health"), probe("https://pillboxhealth.example", -8)],
    lastProbedAt: stamp(-8),
    notes: "No public board; hiring through networks.",
    added: -160,
    updated: -8,
  });
  lead(
    "pillbox-health",
    {
      name: "Meera Krishnan",
      role: "Co-founder",
      handle: "@meerak",
      email: "meera@pillboxhealth.example",
      verified: true,
      verifiedAt: -20,
      source: "https://pillboxhealth.example/team",
      found: -33,
      added: -33,
    },
    {
      status: "call",
      pitch: "Your pharmacy ops problem is a scheduling problem; here is the scheduler I built.",
      ask: "trial",
      attempts: [
        { day: -25, channel: "email", kind: "first", note: "Intro plus the scheduler case study." },
        { day: -18, channel: "email", kind: "followup", note: "Booked the call for Friday." },
      ],
      nextTouch: 2,
      proofLink: "https://portfolio.example/case/pharmacy-scheduler",
      notes: "Call went well; she wants a small trial.",
      touched: -18,
    },
  );
  lead(
    "pillbox-health",
    {
      name: "Ananya Rao",
      role: "Head of Product",
      handle: "@ananya_p",
      email: "ananya@pillboxhealth.example",
      source: "https://pillboxhealth.example/team",
      found: -40,
      added: -40,
    },
    {
      status: "ghosted",
      attempts: [
        { day: -40, channel: "linkedin", kind: "first", note: "DM about the fulfilment roadmap." },
        { day: -36, channel: "email", kind: "followup", note: "Followed up with the dispatch case." },
        { day: -29, channel: "email", kind: "followup", note: "Third send. No reply." },
      ],
      notes: "Three sends, no reply. Ghosted.",
      touched: -29,
    },
  );
  lead(
    "pillbox-health",
    { name: "Ananya Rao", role: "Ops Lead", added: -12 },
    { status: "sourced", notes: "Same name as the Head of Product; this is the ops lead.", touched: -12 },
  );

  // Parked research, with two timed revisits: one future, one due.
  company({
    name: "Riverstone AI",
    website: "https://riverstone.example",
    batch: "S20",
    teamSize: 70,
    stage: "Series B",
    location: "Bengaluru, India",
    oneLiner: "Document extraction for insurers.",
    tags: ["AI", "InsurTech"],
    researchStatus: "parked",
    hiring: hiring(
      "greenhouse",
      "riverstone",
      [
        { title: "ML Engineer", location: "Bengaluru, India", published: -70 },
        { title: "Backend Engineer", location: "Bengaluru, India", published: -80 },
        { title: "Product Manager", location: "Bengaluru, India", published: -95 },
        { title: "Solutions Architect", location: "Mumbai, India", published: -120 },
        { title: "Account Executive", location: "Bengaluru, India", published: -150 },
      ],
      { fetched: -40 },
    ),
    sources: [yc("riverstone-ai"), ats("greenhouse", "https://boards.greenhouse.io/riverstone", -40)],
    lastProbedAt: stamp(-40),
    probeLog: [
      { url: "https://riverstone.example", status: 200 },
      { url: "https://riverstone.example/careers", status: 403 },
    ],
    notes: "Parked until their hiring freeze lifts.",
    added: -420,
    updated: -40,
  });
  lead(
    "riverstone-ai",
    {
      name: "Kabir Shah",
      role: "Founder",
      handle: "@kabirs",
      email: "kabir@riverstone.example",
      source: "https://riverstone.example/team",
      found: -75,
      added: -75,
    },
    {
      status: "revisit",
      attempts: [{ day: -60, channel: "x", kind: "first", note: "DM about the extraction eval." }],
      revisitAfter: 14,
      notes: "Said not now, revisit after their board meeting.",
      touched: -55,
    },
  );
  lead(
    "riverstone-ai",
    {
      name: "Lakshminarayanan Venkataraghavan",
      role: "Principal Engineer",
      email: "lakshminarayanan.venkataraghavan@riverstone.example",
      source: "https://riverstone.example/team",
      found: -60,
      added: -60,
    },
    {
      status: "revisit",
      attempts: [
        { day: -45, channel: "email", kind: "first", note: "Asked about the evaluation harness." },
        { day: -38, channel: "email", kind: "followup", note: "He said to come back this week." },
      ],
      revisitAfter: -2,
      notes: "Timed for this week.",
      touched: -38,
    },
  );

  // Untriaged research with a live trial: the two machines are independent.
  company({
    name: "Orbit Desk",
    website: "https://orbitdesk.example",
    batch: "S23",
    teamSize: 12,
    stage: "Seed",
    location: "Gurugram, India",
    oneLiner: "IT helpdesk for schools.",
    tags: ["SaaS", "EdTech"],
    researchStatus: "untriaged",
    sources: [yc("orbit-desk")],
    added: -80,
    updated: -13,
  });
  lead(
    "orbit-desk",
    {
      name: "Neha Gupta",
      role: "Founder",
      handle: "@neha",
      email: "neha@orbitdesk.example",
      verified: true,
      verifiedAt: -6,
      source: "https://orbitdesk.example/team",
      found: -22,
      added: -22,
    },
    {
      status: "trial",
      pitch: "You sell to schools; the support load is the objection. I have run that desk.",
      ask: "contract",
      attempts: [
        { day: -20, channel: "linkedin", kind: "first", note: "Asked about support volume." },
        { day: -13, channel: "email", kind: "followup", note: "Agreed the trial scope." },
      ],
      nextTouch: 1,
      proofLink: "https://portfolio.example/case/helpdesk",
      notes: "Trial starts Monday.",
      touched: -13,
    },
  );

  // Offer out, contract ask, verified contact.
  company({
    name: "Qwerty Studio",
    website: "https://qwertystudio.example",
    batch: "W20",
    teamSize: 8,
    stage: "Profitable",
    location: "Panaji, India",
    oneLiner: "Brand systems for developer tools.",
    tags: ["Design", "Agency"],
    researchStatus: "researched",
    sources: [yc("qwerty-studio"), probe("https://qwertystudio.example", -34)],
    lastProbedAt: stamp(-34),
    added: -500,
    updated: -10,
  });
  lead(
    "qwerty-studio",
    {
      name: "José Álvarez",
      role: "Design Lead",
      handle: "@jose",
      email: "jose@qwertystudio.example",
      verified: true,
      verifiedAt: -12,
      source: "https://qwertystudio.example/team",
      found: -45,
      added: -45,
    },
    {
      status: "offer",
      pitch: "You need a design engineer who can ship the system, not a deck about it.",
      ask: "contract",
      attempts: [
        { day: -30, channel: "email", kind: "first", note: "Sent the component-system teardown." },
        { day: -22, channel: "other", kind: "followup", note: "Met at the design meetup; sent the offer." },
      ],
      proofLink: "https://portfolio.example/case/design-system",
      notes: "Offer sent; waiting on their decision.",
      touched: -10,
    },
  );

  // Missing fields everywhere: the UI has to render fallbacks, not crash.
  company({
    name: "Duneline",
    researchStatus: "untriaged",
    sources: [yc("duneline", -110)],
    added: -110,
    updated: -110,
  });

  // Declined after two sends, with an internally-filled role.
  company({
    name: "Saffron Street",
    website: "https://saffronstreet.example",
    batch: "S19",
    teamSize: 150,
    stage: "Series B",
    location: "Bengaluru, India",
    oneLiner: "D2C spices and pantry staples.",
    tags: ["Consumer", "Retail"],
    researchStatus: "researched",
    hiring: hiring(
      "workable",
      "saffron-street",
      [
        { title: "Growth Manager", location: "Bengaluru, India", published: -15 },
        { title: "Ops Lead", location: "Bengaluru, India", published: -50 },
      ],
      { fetched: -4 },
    ),
    sources: [yc("saffron-street"), ats("workable", "https://apply.workable.com/saffron-street", -4)],
    lastProbedAt: stamp(-4),
    added: -350,
    updated: -4,
  });
  lead(
    "saffron-street",
    {
      name: "Farah Qureshi",
      role: "Head of Growth",
      email: "farah@saffronstreet.example",
      source: "https://saffronstreet.example/team",
      found: -40,
      added: -40,
    },
    {
      status: "declined",
      attempts: [
        { day: -28, channel: "email", kind: "first", note: "Pitched the retention audit." },
        { day: -21, channel: "email", kind: "followup", note: "They hired internally; keep warm." },
      ],
      notes: "Declined: hired internally. Revisit in six months.",
      touched: -21,
    },
  );

  // Ampersand in the name; a Lead with a name shared at another Company.
  company({
    name: "Zephyr & Co.",
    website: "https://zephyr.example",
    batch: "S21",
    teamSize: 6,
    stage: "Seed",
    location: "Pune, India",
    oneLiner: "Accounting for creator businesses.",
    tags: ["Fintech", "Creator economy"],
    researchStatus: "researched",
    sources: [yc("zephyr-and-co")],
    added: -240,
    updated: -5,
  });
  lead(
    "zephyr-and-co",
    {
      name: "Dev Kumar",
      role: "Founder",
      handle: "@dev_k",
      email: "dev.kumar@zephyr.example",
      source: "https://zephyr.example/team",
      found: -25,
      added: -25,
    },
    { status: "sourced", touched: -5 },
  );

  // Long person name, long role, long unbreakable email.
  company({
    name: "Driftwood Security",
    website: "https://driftwoodsecurity.example",
    batch: "W25",
    teamSize: 5,
    stage: "Seed",
    location: "Bengaluru, India",
    oneLiner: "Secrets management for CI pipelines.",
    tags: ["Security", "DevTools"],
    researchStatus: "researched",
    hiring: hiring("greenhouse", "driftwood", [{ title: "Security Engineer", location: "Bengaluru, India", published: -3 }], {
      fetched: -1,
    }),
    sources: [yc("driftwood-security"), ats("greenhouse", "https://boards.greenhouse.io/driftwood", -1)],
    lastProbedAt: stamp(-1),
    added: -30,
    updated: -1,
  });
  lead(
    "driftwood-security",
    {
      name: "Bartholomew Featherstonehaugh",
      role: "Head of Security Engineering and Developer Experience",
      email: "bartholomew.featherstonehaugh@driftwoodsecurity.example",
      source: "https://driftwoodsecurity.example/team",
      found: -10,
      added: -10,
    },
    { status: "sourced", ask: "trial", touched: -2 },
  );

  // Fresh fetch, stale roles; a follow-up that is due soon.
  company({
    name: "Quiet Harbor",
    website: "https://quietharbor.example",
    batch: "W19",
    teamSize: 22,
    stage: "Series A",
    location: "Kochi, India",
    oneLiner: "Marine logistics for fishing cooperatives.",
    tags: ["Logistics", "Climate"],
    researchStatus: "researched",
    hiring: hiring(
      "greenhouse",
      "quietharbor",
      [
        { title: "Senior Engineer", location: "Kochi, India", published: -120 },
        { title: "Data Engineer", location: "Remote (India)", published: -130 },
        { title: "Product Designer", location: "Kochi, India", published: -145 },
        { title: "Operations Associate", location: "Kochi, India", published: -160 },
      ],
      { fetched: -3 },
    ),
    sources: [yc("quiet-harbor"), ats("greenhouse", "https://boards.greenhouse.io/quietharbor", -3)],
    lastProbedAt: stamp(-3),
    added: -600,
    updated: -3,
  });
  lead(
    "quiet-harbor",
    {
      name: "Dev Kumar",
      role: "CEO",
      handle: "@devkh",
      email: "dev@quietharbor.example",
      verified: true,
      verifiedAt: -15,
      source: "https://quietharbor.example/team",
      found: -20,
      added: -20,
    },
    {
      status: "sent",
      pitch: "You are taking a paper process online; I have done that with three cooperatives.",
      attempts: [
        { day: -12, channel: "email", kind: "first", note: "Sent the cooperative onboarding case." },
        { day: -5, channel: "email", kind: "followup", note: "Followed up with the deck." },
      ],
      nextTouch: 3,
      proofLink: "https://portfolio.example/case/cooperative-onboarding",
      notes: "Follow up on the deck.",
      touched: -5,
    },
  );

  // Board detected, no roles open: the no-posting pitch case.
  company({
    name: "Grainline",
    website: "https://grainline.example",
    batch: "S24",
    teamSize: 14,
    stage: "Seed",
    location: "Jaipur, India",
    oneLiner: "Procurement for textile mills.",
    tags: ["B2B", "Supply chain"],
    researchStatus: "researched",
    hiring: hiring("ashby", "grainline", [], { fetched: -1 }),
    sources: [yc("grainline"), ats("ashby", "https://jobs.ashbyhq.com/grainline", -1)],
    lastProbedAt: stamp(-1),
    added: -45,
    updated: -1,
  });
  lead(
    "grainline",
    {
      name: "Tara Bose",
      role: "Founder",
      handle: "@tarab",
      email: "tara@grainline.example",
      source: "https://grainline.example/team",
      found: -8,
      added: -8,
    },
    {
      status: "drafted",
      pitch: "A no-posting pitch: you need an ops engineer before the next mill, not after.",
      ask: "trial",
      proofLink: "https://portfolio.example/case/procurement",
      nextTouch: 4,
      touched: -1,
    },
  );

  // Three unanswered Attempts: the ladder has run out, no next date set.
  company({
    name: "Northstar Freight",
    website: "https://northstarfreight.example",
    batch: "W13",
    teamSize: 450,
    stage: "Late",
    location: "Mumbai, India",
    oneLiner: "Freight forwarding at scale.",
    tags: ["Logistics", "Enterprise"],
    researchStatus: "parked",
    sources: [yc("northstar-freight"), probe("https://northstarfreight.example", -60)],
    lastProbedAt: stamp(-60),
    notes: "Large and slow; only worth a founder-level pitch.",
    added: -900,
    updated: -19,
  });
  lead(
    "northstar-freight",
    {
      name: "Vikram Sethi",
      role: "CTO",
      handle: "@vsethi",
      email: "vikram@northstarfreight.example",
      verified: true,
      verifiedAt: -35,
      source: "https://northstarfreight.example/team",
      found: -40,
      added: -40,
    },
    {
      status: "sent",
      attempts: [
        { day: -30, channel: "email", kind: "first", note: "Sent the freight ops teardown." },
        { day: -26, channel: "other", kind: "followup", note: "Called the office line; left a message." },
        { day: -19, channel: "email", kind: "followup", note: "Third send. No reply." },
      ],
      notes: "Attempt cap reached; suggest ghosted.",
      touched: -19,
    },
  );

  // Missing batch and headcount; one overdue Lead and one with an overridden date.
  company({
    name: "Pennywise",
    website: "https://pennywise.example",
    batch: null,
    teamSize: null,
    stage: null,
    location: "Remote",
    oneLiner: "Expense tracking for freelancers.",
    tags: ["Fintech", "SMB"],
    researchStatus: "untriaged",
    sources: [yc("pennywise")],
    added: -55,
    updated: -9,
  });
  lead(
    "pennywise",
    {
      name: "Ishita Roy",
      role: "Founder",
      handle: "@ishita",
      email: "ishita@pennywise.example",
      source: "https://pennywise.example/team",
      found: -15,
      added: -15,
    },
    {
      status: "sent",
      pitch: "Your expense parser is good; the reconciliation layer is the gap.",
      attempts: [{ day: -9, channel: "linkedin", kind: "first", note: "Asked about the reconciliation roadmap." }],
      nextTouch: 7,
      nextTouchOverride: true,
      notes: "Next date overridden to after the 15th.",
      touched: -9,
    },
  );
  lead(
    "pennywise",
    { name: "Aarav Mehta", role: "Co-founder", added: -18 },
    {
      status: "sent",
      ask: "trial",
      attempts: [{ day: -11, channel: "email", kind: "first", note: "Sent the reconciliation demo." }],
      nextTouch: -1,
      touched: -11,
    },
  );

  // Two declines at one Company, one with a verified contact.
  company({
    name: "Mango Tree",
    website: "https://mangotree.example",
    batch: "S18",
    teamSize: 60,
    stage: "Series A",
    location: "Bengaluru, India",
    oneLiner: "Supply chain for fresh produce.",
    tags: ["AgTech", "Logistics"],
    researchStatus: "parked",
    sources: [yc("mango-tree")],
    added: -700,
    updated: -65,
  });
  lead(
    "mango-tree",
    {
      name: "Ravi Deshpande",
      role: "COO",
      email: "ravi@mangotree.example",
      verified: true,
      verifiedAt: -50,
      source: "https://mangotree.example/team",
      found: -80,
      added: -80,
    },
    {
      status: "declined",
      attempts: [{ day: -70, channel: "email", kind: "first", note: "They filled the role internally." }],
      touched: -70,
    },
  );
  lead(
    "mango-tree",
    {
      name: "Poornima Iyer",
      role: "Head of Ops",
      handle: "@poornima",
      email: "poornima@mangotree.example",
      source: "https://mangotree.example/team",
      found: -70,
      added: -70,
    },
    {
      status: "declined",
      attempts: [{ day: -65, channel: "email", kind: "first", note: "Second contact, same outcome." }],
      notes: "Second contact, same outcome.",
      touched: -65,
    },
  );

  // A one-word person name with no role and no contact detail.
  company({
    name: "Inkwell",
    website: "https://inkwell.example",
    batch: "W26",
    teamSize: 3,
    stage: "Pre-seed",
    location: "Bengaluru, India",
    oneLiner: "Writing tools for non-native English speakers.",
    tags: ["AI", "EdTech"],
    researchStatus: "researched",
    sources: [yc("inkwell", -5)],
    added: -20,
    updated: -4,
  });
  lead("inkwell", { name: "Rae", added: -4 }, { status: "sourced", touched: -4 });

  // Unicode display strings; the slug is explicit because the id rules strip
  // non-ASCII, and this fixture is about display, not about re-deriving ids.
  company({
    name: "Ünïcode Labs",
    slug: "unicode-labs",
    website: "https://unicode.example",
    batch: "S22",
    teamSize: 11,
    stage: "Seed",
    location: "Bengaluru, India",
    oneLiner: "Résumé parsing for 11 Indian languages 🌍",
    tags: ["AI", "HR Tech"],
    researchStatus: "researched",
    hiring: hiring("lever", "unicode", [{ title: "Applied ML Engineer", location: "Bengaluru, India", published: -16 }], {
      fetched: -2,
    }),
    sources: [yc("unicode-labs"), ats("lever", "https://jobs.lever.co/unicode", -2)],
    lastProbedAt: stamp(-2),
    added: -90,
    updated: -2,
  });
  lead(
    "unicode-labs",
    {
      name: "Søren Åberg",
      role: "Founding Engineer",
      handle: "@soren",
      email: "soren@unicode.example",
      source: "https://unicode.example/team",
      found: -12,
      added: -12,
    },
    {
      status: "drafted",
      pitch: "Multilingual parsing is an eval problem; here is the eval harness I built.",
      attempts: [{ day: -4, channel: "linkedin", kind: "first", note: "Wrote in Danish; asked about the parser." }],
      nextTouch: 5,
      proofLink: "https://portfolio.example/case/parsing",
      touched: -4,
    },
  );

  return {
    version: 2,
    updatedAt: stamp(-1, 22),
    companies,
    people,
    leads,
  };
}
