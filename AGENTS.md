# Agent notes: leadline

Standalone personal tool. Read `README.md` first; this file only covers what an
agent should do differently from a generic codebase.

## Interfaces, in order of preference

1. **JSON** - `GET /api/leads?stage=sent&roles=1` and `GET /api/leads/<slug>`.
   Read these rather than scraping the HTML.
2. **CLI** - `node scripts/cli.mjs list --json`, `... set --slug <slug> --stage ...`.
3. **Markdown dossiers** - `data/dossiers/<slug>.md`, regenerated on every write.

## Rules

- **Never send anything.** No DMs, no email, no LinkedIn automation. The tool
  tracks state; the human writes and sends. This is a hard boundary, not a
  preference.
- **Never fetch a third-party API from a page render or route handler.** All
  fetching belongs in `lib/ingest.mjs`, invoked by the CLI. The UI must keep
  working offline from `data/db.json`.
- **Every new fact needs provenance.** Add a `sources[]` entry with `source`,
  `url` and `fetchedAt`. A field without a source and a date is a rumour.
- **Never present an inferred email as verified.** `emailVerified` stays false
  until a human or a verification service confirms it.
- **`data/` is personal and gitignored.** Do not add lead data, contacts or
  notes to git, to fixtures, or to a commit message.
- **Do not add a second source adapter** unless a specific gap is named. One
  working adapter beats four half-built ones.

## Where to change things

| Task | File |
|---|---|
| New source (HN, VC portfolio, funding) | `lib/ingest.mjs` + a subcommand in `scripts/cli.mjs` |
| Data shape / dedupe / dossiers | `lib/store.mjs` |
| Table, filters, detail view | `app/page.js`, `app/c/[slug]/page.js` |
| Outreach form fields | `app/c/[slug]/page.js` + `app/actions.js` |
| Styling | `app/globals.css` (no UI library, no Tailwind) |
