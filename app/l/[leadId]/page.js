import Link from "next/link";
import { notFound } from "next/navigation";
import { getLead } from "../../../lib/store.mjs";
import {
  attemptsNewestFirst,
  contactSummary,
  defaultAttemptKind,
  isoDay,
  LADDER_DAYS,
  ladderSuggestion,
  legalLeadTransitions,
} from "../../../lib/core.mjs";
import { saveLeadStatus, saveNextTouch, saveReply } from "../../actions.js";
import AttemptForm from "./attempt-form.js";

export const dynamic = "force-dynamic";

/**
 * One Lead: the attempts already made, the next date the ladder proposes, and
 * the forms that record what happened. Everything on this page is a stored
 * fact; the ladder only proposes, and every proposal is visible and refusable.
 */
export default async function LeadPage({ params, searchParams }) {
  const { leadId } = await params;
  const sp = (await searchParams) || {};
  const error = typeof sp.error === "string" ? sp.error : "";

  const row = getLead(leadId);
  if (!row) notFound();

  const { lead, person, company } = row;
  const companySlug = company?.slug || lead.companySlug;
  const today = isoDay(new Date());
  const attempts = attemptsNewestFirst(lead.attempts || []);
  const suggestion = ladderSuggestion({ status: lead.status, attempts: lead.attempts || [] });
  const defaultKind = defaultAttemptKind(lead.attempts || []);
  const legal = legalLeadTransitions(lead.status);
  const moves = legal.filter((s) => s !== "revisit");
  const canReply = legal.includes("replied");
  const canRevisit = legal.includes("revisit");
  const atCap = suggestion.status === "ghosted";
  const contact = contactSummary(person || {});

  return (
    <main className="wrap">
      <Link className="back" href={`/c/${companySlug}`}>
        ← {company?.name || companySlug}
      </Link>

      <div className="title">
        <h1>{person?.name || "(unknown person)"}</h1>
        <span className={`chip ${lead.status}`}>{lead.status}</span>
      </div>
      <div className="meta-line">
        {person?.role ? `${person.role} · ` : ""}
        <Link href={`/c/${companySlug}`}>{company?.name || companySlug}</Link>
        {contact ? ` · ${contact}` : ""}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="grid">
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Attempts {attempts.length ? `(${attempts.length})` : ""}</h2>
            {attempts.length ? (
              <ul className="attempts">
                {attempts.map((a, i) => (
                  <li key={`${a.date}-${i}`}>
                    <div className="when">
                      {a.date} · {a.channel} · {a.kind}
                    </div>
                    {a.note ? <div className="what">{a.note}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No Attempts yet. Log the first one after you send; the ladder takes it from there.</p>
            )}
          </div>

          <div className="card">
            <h2>Log an attempt</h2>
            <AttemptForm lead={lead} today={today} defaultKind={defaultKind} />
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Ladder</h2>
            {suggestion.stopped ? (
              <p className="hint" style={{ margin: 0 }}>
                Stopped: a reply or a status past sent. The next date is yours to set.
              </p>
            ) : atCap ? (
              <>
                <p style={{ marginTop: 0 }}>
                  <b>{suggestion.count} unanswered Attempts; the ladder has run out.</b> Ghost this Lead, or override
                  a date below to keep trying.
                </p>
                <form action={saveLeadStatus}>
                  <input type="hidden" name="leadId" value={lead.leadId} />
                  <input type="hidden" name="back" value={`/l/${lead.leadId}`} />
                  <input type="hidden" name="status" value="ghosted" />
                  <button type="submit">Confirm ghosted</button>
                </form>
                <p className="hint" style={{ marginTop: 14, marginBottom: 0 }}>
                  Refusing costs nothing: the status stays {lead.status} until you press this.
                </p>
              </>
            ) : suggestion.nextTouch ? (
              <p style={{ marginTop: 0, marginBottom: 0 }}>
                After {suggestion.count} Attempt{suggestion.count === 1 ? "" : "s"}, the ladder proposes{" "}
                <b>{suggestion.nextTouch}</b> (+{suggestion.days} days).
                {lead.nextTouchOverride ? (
                  <span className="sub"> Overridden to {lead.nextTouch} by hand.</span>
                ) : lead.nextTouch ? (
                  <span className="sub"> Set on the Lead.</span>
                ) : (
                  <span className="sub"> Not set on the Lead.</span>
                )}
              </p>
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                No Attempts logged yet. The first proposes +{LADDER_DAYS[0]} days, the second +{LADDER_DAYS[1]}, and a
                third unanswered one suggests ghosted.
              </p>
            )}
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Status</h2>
            <form action={saveLeadStatus}>
              <input type="hidden" name="leadId" value={lead.leadId} />
              <input type="hidden" name="back" value={`/l/${lead.leadId}`} />
              <div className="field">
                <label htmlFor="lead-status">Move to</label>
                <select id="lead-status" name="status" defaultValue={lead.status}>
                  <option value={lead.status}>{lead.status}</option>
                  {moves.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit">Move</button>
            </form>
            {canReply ? (
              <form action={saveReply} style={{ marginTop: 10 }}>
                <input type="hidden" name="leadId" value={lead.leadId} />
                <button type="submit">They replied</button>
              </form>
            ) : null}
            <p className="hint" style={{ marginTop: 14 }}>
              {moves.length
                ? `Legal from ${lead.status}: ${moves.join(", ")}.${canRevisit ? " A revisit is timed below." : ""}`
                : "Terminal: this Lead has ended."}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Next touch</h2>
            <p style={{ marginTop: 0 }}>
              {lead.nextTouch ? <b>{lead.nextTouch}</b> : <span className="hint">none</span>}
              {lead.nextTouchOverride ? (
                <span className="sub"> · overridden by hand</span>
              ) : lead.nextTouch ? (
                <span className="sub"> · {suggestion.stopped ? "scheduled" : "from the ladder"}</span>
              ) : null}
            </p>
            <form action={saveNextTouch}>
              <input type="hidden" name="leadId" value={lead.leadId} />
              <div className="field">
                <label htmlFor="next-touch">Override the date</label>
                <input id="next-touch" name="date" type="date" defaultValue={lead.nextTouch || ""} />
              </div>
              <button type="submit">Set</button>
            </form>
            <p className="hint" style={{ marginTop: 14 }}>
              An override survives later Attempts. Clear it to hand the date back; the next Attempt proposes one again.
            </p>
          </div>

          {canRevisit || lead.status === "revisit" ? (
            <div className="card">
              <h2>Revisit</h2>
              <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
                {lead.status === "revisit" && lead.revisitAfter
                  ? `Timed for ${lead.revisitAfter}; that date is when it comes back into view.`
                  : '"Not now" is timed, not lost: a revisit needs a date, and the date is what brings it back.'}
              </p>
              <form action={saveLeadStatus}>
                <input type="hidden" name="leadId" value={lead.leadId} />
                <input type="hidden" name="back" value={`/l/${lead.leadId}`} />
                <input type="hidden" name="status" value="revisit" />
                <div className="field">
                  <label htmlFor="revisit-date">Come back on</label>
                  <input
                    id="revisit-date"
                    name="revisitAfter"
                    type="date"
                    defaultValue={lead.revisitAfter || ""}
                    required
                  />
                </div>
                <button type="submit">{lead.status === "revisit" ? "Move the date" : "Time this Lead"}</button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
