# Domain Docs

How the engineering skills consume this repo's domain documentation before
exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root. Single context: one glossary, no map.
- **`docs/adr/`** — read the ADRs that touch the area you are about to work in.

If a file does not exist, proceed silently. Don't flag its absence. Terms and
decisions are captured lazily by `/grill-with-docs` as they get resolved.

## Structure

Single context, so:

```
GLOSSARY.md
docs/adr/0001-company-and-lead-are-separate-records.md
```

No `GLOSSARY-MAP.md`. No per-directory glossaries. If this ever becomes more
than one context, that is the moment to introduce a map, not before.

## Use the glossary's vocabulary

Issue titles, test names, refactor proposals and commit messages use the terms
as defined in `GLOSSARY.md`. In particular:

- **Company** is the organization; **Lead** is one named person at it.
- **Stage** is the company's funding round; **Status** is where the Lead stands
  with you. Never swap them.
- **Attempt**, never "touch", "send" or "ping".
- **Brief** is what you read before writing; **draft** is what the tool
  deliberately does not produce.

If a concept you need isn't in the glossary, that's a signal: either it's
invented language to reconsider, or a real gap to note for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it rather than silently
overriding it: _Contradicts ADR-0001 (Company and Lead are separate), but worth
reopening because…_
