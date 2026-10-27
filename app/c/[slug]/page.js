import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany, RESEARCH_STATUSES } from "../../../lib/store.mjs";
import { legalLeadTransitions, legalResearchTransitions, contactSummary } from "../../../lib/core.mjs";
import { saveLeadStatus, savePerson, saveResearchStatus } from "../../actions.js";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }) {
  const { slug } = await params;
  const row = getCompany(slug);
  if (!row) notFound();

  const { company: c, leads } = row;
  const roles = c.hiring?.roles || [];
  const research = c.researchStatus || "untriaged";

  return (
    <main className="wrap">
      <Link className="back" href="/">
        ← all leads
      </Link>

      <div className="title">
        <h1>{c.name}</h1>
        <span className={`chip ${research}`}>{research}</span>
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
            <h2>Leads {leads.length ? `(${leads.length})` : ""}</h2>
            {leads.length ? (
              <ul className="roles">
                {leads.map((l) => (
                  <li key={l.leadId} className="lead">
                    <div>
                      <b>{l.person?.name || "(unknown person)"}</b>
                      {l.person?.role ? <span className="sub"> · {l.person.role}</span> : null}
                      <div className="sub">
                        <code>{l.leadId}</code>
                        {contactSummary(l.person || {}) ? ` · ${contactSummary(l.person || {})}` : ""}
                      </div>
                    </div>
                    <form action={saveLeadStatus} className="inline">
                      <input type="hidden" name="leadId" value={l.leadId} />
                      <select name="status" defaultValue={l.status} aria-label={`Status for ${l.person?.name || l.leadId}`}>
                        <option value={l.status}>{l.status}</option>
                        {legalLeadTransitions(l.status).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button type="submit">Move</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                No named human yet. This Company is a research task, not a Lead: move its research state on the right, then name
                the person who owns the area. Two people here become two Leads with independent statuses.
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

        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Research</h2>
            <form action={saveResearchStatus}>
              <input type="hidden" name="company" value={c.slug} />
              <div className="field">
                <label htmlFor="research">Company state</label>
                <select id="research" name="status" defaultValue={research}>
                  <option value={research}>{research}</option>
                  {legalResearchTransitions(research).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit">Move</button>
            </form>
            <p className="hint" style={{ marginTop: 14 }}>
              Research is the Company&apos;s own state: {RESEARCH_STATUSES.join(" → ")}. It says how far the research has gone,
              never how far a conversation has.
            </p>
          </div>

          <div className="card">
            <h2>Name a human</h2>
            <form action={savePerson}>
              <input type="hidden" name="company" value={c.slug} />
              <div className="field">
                <label htmlFor="person-name">Name</label>
                <input id="person-name" name="name" type="text" required placeholder="Priya Sharma" />
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="person-role">Role</label>
                  <input id="person-role" name="role" type="text" placeholder="Founder" />
                </div>
                <div className="field">
                  <label htmlFor="person-handle">Handle</label>
                  <input id="person-handle" name="handle" type="text" placeholder="@priya" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="person-email">Email</label>
                <input id="person-email" name="email" type="email" placeholder="only if you found it" />
              </div>
              <div className="field">
                <label htmlFor="person-source">Source</label>
                <input
                  id="person-source"
                  name="contactSource"
                  type="text"
                  placeholder="where you found this person"
                />
              </div>
              <button type="submit">Add as Lead</button>
            </form>
            <p className="hint" style={{ marginTop: 14 }}>
              Naming a human is what creates a Lead, at status sourced. An unverified email stays unverified; nothing here sends
              anything.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
