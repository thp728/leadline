"use client";

import { useState } from "react";
import {
  ATTEMPT_CHANNELS,
  ATTEMPT_KINDS,
  LADDER_DAYS,
  isIsoDate,
  ladderSuggestion,
  planAttempt,
} from "../../../lib/core.mjs";
import { saveAttempt } from "../../actions.js";

/**
 * The log form is the one place the ladder's arithmetic is visible before it
 * happens: the proposal is recomputed from the date actually typed, so the
 * checkbox can never promise a date the server will not store.
 *
 * A ghosted status is never offered here. The cap produces a proposal on the
 * page instead, so a status change always takes its own deliberate press.
 */
export default function AttemptForm({ lead, today, defaultKind }) {
  const [date, setDate] = useState(today);
  const valid = isIsoDate(date) && date <= today;
  const proposal = valid ? planAttempt(lead, { date, channel: "email", kind: defaultKind }, { today, accept: true }) : null;
  const suggestion = ladderSuggestion({ status: lead.status, attempts: lead.attempts || [] });
  const atCap = suggestion.status === "ghosted";
  const clearsDate = Boolean(proposal?.suggestion.status === "ghosted" && lead.nextTouch);
  const acceptsDate = Boolean(proposal?.suggestion.nextTouch);
  const showAccept = !lead.nextTouchOverride && (acceptsDate || clearsDate);

  return (
    <form action={saveAttempt}>
      <input type="hidden" name="leadId" value={lead.leadId} />
      <div className="row2">
        <div className="field">
          <label htmlFor="attempt-date">Date</label>
          <input
            id="attempt-date"
            name="date"
            type="date"
            value={date}
            max={today}
            required
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="attempt-kind">Kind</label>
          <select id="attempt-kind" name="kind" defaultValue={defaultKind}>
            {ATTEMPT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="attempt-channel">Channel</label>
          <select id="attempt-channel" name="channel" defaultValue="email">
            {ATTEMPT_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="attempt-note">Note (optional)</label>
          <input id="attempt-note" name="note" type="text" placeholder="what you said" />
        </div>
      </div>

      {showAccept ? (
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" name="accept" value="1" defaultChecked />
          {acceptsDate
            ? `Set next touch to ${proposal.suggestion.nextTouch} (+${proposal.suggestion.days} days)`
            : "Clear the next touch: the ladder has run out"}
        </label>
      ) : null}

      <button type="submit">Log attempt</button>

      <p className="hint" style={{ marginTop: 14 }}>
        {suggestion.stopped
          ? "The ladder is stopped by a reply or a status past sent; set the next date yourself."
          : atCap
            ? "The ladder has run out: confirm or refuse ghosting in the Ladder card."
            : !lead.attempts?.length
              ? `The first Attempt proposes +${LADDER_DAYS[0]} days, the second +${LADDER_DAYS[1]}; a third unanswered one suggests ghosted.`
              : "Nothing is applied silently: untick the box to log the Attempt without the date."}
      </p>
    </form>
  );
}
