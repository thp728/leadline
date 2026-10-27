# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `thp728/leadline`. Use the
`gh` CLI for all operations.

The repo is public. Culture here is one user, one job search: issues describe
behaviour and screens, never lead data, contact details or notes. Anything
personal stays in `data/` on the machine that owns it.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <path>`.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label`.
- **Close**: `gh issue close <number> --comment "..."`.
- **Blocking**: `Blocked by: #<n>, #<n>` at the top of the child body. Where
  native issue dependencies are available, prefer them:
  `gh api --method POST repos/thp728/leadline/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  where `<blocker-db-id>` is the blocker's database id
  (`gh api repos/thp728/leadline/issues/<n> --jq .id`).

`gh` infers the repo from the clone; no flags needed.

## Pull requests as a triage surface

**PRs as a request surface: no.** Single-user tool; `/triage` reads this flag.

## When a skill says "publish to the issue tracker"

Create a GitHub issue. Specs go there too — not into `docs/`. `docs/` holds
`adr/` and `agents/` only.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Specs and their tickets

A spec is one issue labelled `spec`, and its tickets are **sub-issues** of it, so
the spec tracks itself through `sub_issues_summary`. A spec issue carries no
triage label: it is a parent, not grabbable work, and `ready-for-agent` on a
parent puts the spec at the top of every frontier query.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as
tickets. Maps and tickets carry only `wayfinder:*` labels, never a triage label:
they are decisions, not implementation work.

- **Map**: one issue labelled `wayfinder:map`, holding Destination / Notes /
  Decisions so far / Not yet specified / Out of scope.
  `gh issue create --label wayfinder:map`.
- **Child ticket**: a sub-issue of the map, as in **Specs and their tickets**
  above. Labels: `wayfinder:<type>` — `research`, `prototype`, `grilling` or
  `task`.
- **Blocking**: native issue dependencies, the canonical and UI-visible form.
  Add an edge with
  `gh api --method POST repos/thp728/leadline/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  where `<blocker-db-id>` is the blocker's numeric database id
  (`gh api repos/thp728/leadline/issues/<n> --jq .id`), not its `#number`.
  GitHub reports `issue_dependencies_summary.blocked_by` — open blockers only,
  the live gate. Fall back to a `Blocked by: #<n>` line only if dependencies are
  unavailable.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
  The assignee *is* the claim; an open, unassigned ticket is unclaimed.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then
  `gh issue close <n>`, then append a context pointer to the map's
  Decisions-so-far.
- **Frontier query**: open, unassigned children of the map with
  `issue_dependencies_summary.blocked_by == 0`; first in map order wins.
