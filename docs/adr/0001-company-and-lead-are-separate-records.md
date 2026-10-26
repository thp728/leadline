# Company and Lead are separate records

**Status:** accepted

v0 tracked outreach per company: `outreach[slug] = { stage, nextTouch }`. That
cannot express two people at one company, cannot say who a follow-up is owed to,
and collapses two different problems — "I have not found a human here" and "I am
waiting on Priya" — into one field. So the person is now the unit of work: a
**Company** carries public facts and its own research state
(`untriaged → researched → parked`), and a **Lead** is one named person at that
company with its own status (`sourced → drafted → sent → replied → call → trial →
offer | declined | revisit | ghosted`), its own attempts, and its own pitch. A
company with nobody named is not a lead yet; it is a research task.

## Considered Options

- **One state field on the company row**, with the person as an annotation.
  Cheaper, one screen, but "sourced" would then mean both "I have a name and a
  pitch" and "I have a URL", which is exactly the ambiguity that makes job
  trackers rot.
- **Companies only, people as free text in notes.** No identity, so no attempt
  history and no reply rate. Rejected.

## Consequences

- Two state machines, so two surfaces: the morning screen shows Leads, the
  research queue shows Companies.
- `sourced` changes meaning: in v0 it meant "ingested company row", in v1 it
  means "named human and a pitch, nothing sent". The data migration discards the
  v0 `outreach` map rather than reinterpreting it — every entry was empty, so
  nothing is lost.
- Every Lead is reachable from its Company, but no Company field is copied onto
  a Lead. The Company stays the single home of public facts.
