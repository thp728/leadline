import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany, CHANNELS, STAGES } from "../../../lib/store.mjs";
import { saveOutreach } from "../../actions.js";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }) {
  const { slug } = await params;
  const row = getCompany(slug);
  if (!row) notFound();

  const { company: c, outreach: o } = row;
  const roles = c.hiring?.roles || [];

  return (
    <main className="wrap">
      <Link className="back" href="/">
        ← all leads
      </Link>

      <div className="title">
        <h1>{c.name}</h1>
        <span className={`chip ${o.stage}`}>{o.stage}</span>
      </div>
      <div className="meta-line">
        {c.oneLiner ? `${c.oneLiner} · ` : ""}
        {c.website ? (
          <a href={c.website} target="_blank" rel="noreferrer">
            {c.website.replace(/^https?:\/\//, "")}
          </a>
        ) : null}
        {c.location ? ` · ${c.location}` : ""}
      </div>

      <div className="grid">
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Facts</h2>
            <div className="facts">
              {[
                ["Batch", c.batch],
                ["Headcount", c.teamSize],
                ["Stage", c.stage],
                ["Domain", (c.website || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0]],
                ["Board", c.hiring ? `${c.hiring.ats} · ${c.hiring.boardId}` : "none detected"],
                ["Probed", c.lastProbedAt ? c.lastProbedAt.slice(0, 10) : "never"],
              ].map(([k, v]) => (
                <div className="fact" key={k}>
                  <div className="k">{k}</div>
                  <div className="v">{v || "—"}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Open roles {c.hiring ? `(${roles.length})` : ""}</h2>
            {roles.length ? (
              <ul className="roles">
                {roles.slice(0, 20).map((r, i) => (
                  <li key={`${r.title}-${i}`}>
                    <span>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                    </span>
                    <span className="sub">{r.location || ""}</span>
                  </li>
                ))}
              </ul>
            ) : c.hiring ? (
              <p className="hint">Board is empty right now. That is still a signal: no posted role means a pitch, not an application.</p>
            ) : (
              <p className="hint">
                No public job board found. Check the careers page by hand, then treat this as the no-posting case: name the role
                hypothesis yourself.
              </p>
            )}
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h2>People</h2>
            {(c.people || []).length ? (
              <ul className="roles">
                {c.people.map((p, i) => (
                  <li key={`${p.name}-${i}`}>
                    <span>
                      <b>{p.name}</b>
                      {p.role ? <span className="sub"> · {p.role}</span> : null}
                    </span>
                    <span className="sub">
                      {p.email ? `${p.email}${p.emailVerified ? " ✓" : " (unverified)"}` : p.handle || ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                Unknown. Find a named human (founder, CTO, or the engineer who owns the area) before drafting anything.
              </p>
            )}
          </div>

          <div className="card">
            <h2>Provenance</h2>
            <ul className="prov">
              {(c.sources || []).map((s, i) => (
                <li key={`${s.source}-${i}`}>
                  <b>{s.source}</b> · {s.url} · {s.fetchedAt?.slice(0, 10)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <h2>Outreach</h2>
          <form action={saveOutreach}>
            <input type="hidden" name="slug" value={c.slug} />

            <div className="row2">
              <div className="field">
                <label htmlFor="stage">Stage</label>
                <select id="stage" name="stage" defaultValue={o.stage || "sourced"}>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="channel">Channel</label>
                <select id="channel" name="channel" defaultValue={o.channel || ""}>
                  <option value="">—</option>
                  {CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row2">
              <div className="field">
                <label htmlFor="firstTouch">First touch</label>
                <input id="firstTouch" name="firstTouch" type="date" defaultValue={o.firstTouch || ""} />
              </div>
              <div className="field">
                <label htmlFor="nextTouch">Next touch</label>
                <input id="nextTouch" name="nextTouch" type="date" defaultValue={o.nextTouch || ""} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="proofLink">Proof link</label>
              <input
                id="proofLink"
                name="proofLink"
                type="url"
                placeholder="the one artifact this message leads with"
                defaultValue={o.proofLink || ""}
              />
            </div>

            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" rows={6} defaultValue={o.notes || ""} />
            </div>

            <button type="submit">Save</button>
          </form>

          <p className="hint" style={{ marginTop: 14 }}>
            Drafting and sending stay manual. This app tracks state and evidence; it never messages anyone.
          </p>
        </div>
      </div>
    </main>
  );
}
