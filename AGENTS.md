# Agent notes: leadline

Standalone personal tool. Read `README.md` first; this file only covers what an
agent should do differently from a generic codebase.

## Interfaces, in order of preference

1. **JSON** - `GET /api/leads?status=sourced&roles=1` and `GET /api/leads/<company-slug>`.
   Read these rather than scraping the HTML.
2. **CLI** - `node scripts/cli.mjs list --json`, `... add-person --company <slug> --name "..."`.
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
- **Never run `npm run build` while `npm run dev` is running.** They share
  `.next`; the build overwrites the dev server's chunks and every page 500s with
  `Cannot find module './NNN.js'`. Stop dev, `npm run clean`, then rebuild.

## Where to change things
| Task | File |
|---|---|
| New source (HN, VC portfolio, funding) | `lib/ingest.mjs` + a subcommand in `scripts/cli.mjs` |
| Decisions: slug, domain, dedupe, lead ids, both status machines, migration, list filters | `lib/core.mjs` + `test/core.test.mjs` |
| JSON persistence / dossiers / one-time migration write-back | `lib/store.mjs` + `test/store.test.mjs` |
| Table, filters, detail view | `app/page.js`, `app/c/[slug]/page.js` |
| Name-a-human, Lead status, research state forms | `app/c/[slug]/page.js` + `app/actions.js` |
| Styling | `app/globals.css` (no UI library, no Tailwind) |

## Agent skills

### Issue tracker

GitHub Issues on `thp728/leadline`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings equal to their names. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
