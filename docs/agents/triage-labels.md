# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those
roles to the label strings used in this repo's tracker.

| Role in the skills | Label in this tracker | Meaning                                   |
| ------------------ | --------------------- | ----------------------------------------- |
| `needs-triage`     | `needs-triage`        | Needs evaluating before anyone works on it |
| `needs-info`       | `needs-info`          | Waiting on the human for more information  |
| `ready-for-agent`  | `ready-for-agent`     | Fully specified, ready for an agent        |
| `ready-for-human`  | `ready-for-human`     | Needs a human to do it                     |
| `wontfix`          | `wontfix`             | Will not be actioned                       |

When a skill mentions a role, use the label string from this table.

Tickets produced by `/to-tickets` are agent-grabbable by construction and carry
`ready-for-agent` on creation.
