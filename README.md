# leadline

Personal lead pipeline for founder-led outreach. Standalone: it reads and writes
only its own `data/` directory, and nothing in it is shared with another vault or
repo. Import and export are manual on purpose.

Built for one user, one job search. Not a SaaS, not multi-tenant, no auth.

## Why this shape

The lead data is public: startup ATS boards (Greenhouse, Ashby, Lever) expose
unauthenticated JSON, the YC directory has a public mirror, and funding news is
free. None of that is a moat, so there is nothing to protect and nothing to sell.
What the tool buys is time and consistency: a corpus you own, refreshed on
demand, with provenance on every field.

Two rules keep it from rotting:

1. **Batch, never request-path.** The UI reads `data/db.json`. All fetching
   happens in the CLI, on demand. No third-party request when you open a page.
2. **Humans send.** The app tracks state and evidence. It never messages anyone,
   never automates LinkedIn, and never sends email.

## Run

```powershell
npm install
npm run dev            # http://localhost:4317
npm test               # node --test, no extra deps
```

## Mock corpus

For UI work there is a generated corpus with no real people in it:

```powershell
npm run mock           # writes data-mock/db.json and its dossiers
npm run dev:mock       # http://localhost:4318, generates the corpus if missing
```

`data-mock/` is gitignored and regenerated from `scripts/mock-data.mjs`, so a
fresh clone needs only `npm install && npm run dev:mock`. Dates are relative to
the day you generate it; pass `--today 2026-10-27` to `npm run mock` for a fixed
corpus. The mock writer refuses to target `data/`, and the dev script uses its
own port and build directory, so it can run beside the real app without
touching your corpus.

The fixture covers what the UI branches on: all three research states and all
ten Lead statuses, zero to three Leads per company, repeat names that take a
`-2` id, verified and unverified emails, missing fields, long and Unicode
strings, stale hiring snapshots, empty boards, no board, attempts from zero to
three, and next touches and revisits that are overdue, due today and scheduled.
`test/mock.test.mjs` keeps the coverage honest.

Ingest and enrich from the CLI:

```powershell
node scripts/cli.mjs yc --min 5 --max 150 --loc india --limit 40
node scripts/cli.mjs enrich --limit 10
node scripts/cli.mjs list --has-roles
node scripts/cli.mjs add-person --company bolna-ai --name "Priya Sharma" --role Founder
node scripts/cli.mjs set-research --company bolna-ai --status researched
```

`enrich --slug <slug>` probes one company. It tries the homepage, `/careers` and
`/jobs`, detects the ATS, then pulls the board's roles from the public API.

## Agent interface

The same data is available as JSON, which is what an agent should read instead of
scraping the HTML:

```
GET /api/leads?status=sourced&roles=1
GET /api/leads/<company-slug>
```

`node scripts/cli.mjs list --json` is the CLI equivalent. Dossiers are regenerated as
Markdown in `data/dossiers/<slug>.md` on every write.

## Data model

`data/db.json`, schema version 2. A v0 file is migrated once on load: every
Company keeps its facts and gains `researchStatus: "untriaged"`, the v0
`outreach` map is discarded, and `people` and `leads` start empty.

```
companies[slug] = {
  slug, name, website, batch, batchYear, batchSeason,
  teamSize, stage, location, regions, oneLiner, tags,
  researchStatus: "untriaged" | "researched" | "parked",
  hiring: { ats, boardId, foundOn, roles[], fetchedAt } | null,
  sources: [{ source, url, fetchedAt }],
  lastProbedAt, probeLog, notes, createdAt, updatedAt
}

people[personId] = {
  personId, companySlug, name, role, handle, email,
  emailVerified, contactSource, sources[], verifiedAt, createdAt
}

leads[leadId] = {
  leadId, companySlug, personId,
  status, pitch, ask, attempts[], nextTouch, revisitAfter,
  proofLink, notes, createdAt, updatedAt
}
```

`leadId` is `<companySlug>--<personSlug>`, assigned once when the person is
named. A rename edits the person and leaves the id alone; a repeated name takes
the next free suffix (`-2`, `-3`). Two people at one Company are two Leads with
independent statuses and attempts. A contact detail carries its source and fetch
date, and an unverified email stays unverified.

Research state (the Company machine): `untriaged → researched → parked`, and
back. Lead status (the Lead machine): `sourced → drafted → sent → replied →
call → trial → offer`, with side exits to `declined`, `revisit` and `ghosted`
from any active status. `ghosted` can return to `replied`. Both machines refuse
illegal moves and name the legal set.

`revisit` is the state that matters most and exists nowhere in a job tracker: the
founder said "not now". A lead is not rejected, it is timed.

## Boundaries

- `data/` is gitignored. Leads, contacts and notes never enter git.
- Nothing is written outside this repo. If a dossier belongs in another system,
  copy it there yourself.
- No LinkedIn scraping, no automated DMs, no bulk email. Any source adapter must
  be public and keyless, or not exist.
- Every field carries a source URL and a fetch date. An undated fact is a rumour;
  an inferred email is marked `unverified` until checked.

## What is deliberately not built

- A scheduler. Run the CLI when you want fresh data.
- A database server. JSON at this size is faster to work with and diffable.
- A second source adapter. Add one when a specific gap bites, not because the
  list looks incomplete.
- Drafting. Write the message yourself; the app gives you the facts, the person
  and the proof link.

## Kill criteria

If after four weeks it does not produce 20 usable leads a week in under an hour,
with 80% of them having a verified contact, delete it and go back to doing it by
hand.

## Troubleshooting

**`Cannot find module './887.js'` / blank error page in dev**

`next build` and `next dev` write to the same `.next` directory. Building while
the dev server is running corrupts the dev chunks. Stop the dev server, then:

```powershell
npm run clean
npm run dev
```

Never run `npm run build` with `npm run dev` still up. For production, stop dev
first and use `npm run build && npm start`.
