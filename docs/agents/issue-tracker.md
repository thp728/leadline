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
