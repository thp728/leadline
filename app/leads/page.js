import Link from "next/link";
import { listLeads, stats, LEAD_STATUSES, LEAD_IN_FLIGHT_STATUSES } from "../../lib/store.mjs";

export const dynamic = "force-dynamic";

function statusChip(status) {
  return <span className={`chip ${status}`}>{status}</span>;
}

/**
 * The corpus table: every Lead, with the filters that narrow it. The morning
 * screen answers what to do now; this is where you find one among many.
 */
export default async function Leads({ searchParams }) {
  const sp = (await searchParams) || {};
  const status = typeof sp.status === "string" && sp.status ? sp.status : undefined;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const hasRoles = sp.roles === "1";

  const rows = listLeads({ status, q, hasRoles });
  const s = stats();
  const inFlight = LEAD_IN_FLIGHT_STATUSES.reduce((n, st) => n + (s.byStatus[st] || 0), 0);

  return (
    <main className="wrap">
      <Link className="back" href="/">
        ← today
      </Link>

      <div className="top">
        <div className="brand">
          <b>leadline</b> / all leads
        </div>
        <div className="counts">
          <span>
            <b>{s.leads}</b> leads
          </span>
          <span>
            <b>{s.needsHuman}</b> companies need a human
          </span>
          <span>
            <b>{inFlight}</b> in flight
          </span>
          <span>
            <b>{s.byResearch.untriaged}</b> untriaged
          </span>
        </div>
      </div>

      <form className="filters" method="get">
        <input type="search" name="q" placeholder="Search person, company, location, batch" defaultValue={q || ""} />
        <select name="status" defaultValue={status || ""}>
          <option value="">Any status</option>
          {LEAD_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" name="roles" value="1" defaultChecked={hasRoles} />
          Has open roles
        </label>
        <button type="submit">Filter</button>
        {(status || q || hasRoles) && (
          <Link className="hint" href="/leads">
            reset
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="empty">
          <p>No leads yet.</p>
          <p>
            Ingest some: <code>node scripts/cli.mjs yc --limit 40</code> then{" "}
            <code>node scripts/cli.mjs enrich --limit 10</code>
          </p>
          <p>
            A Lead is a named human. Name one:{" "}
            <code>node scripts/cli.mjs add-person --company &lt;slug&gt; --name &quot;Priya Sharma&quot;</code>
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Company</th>
              <th>Batch</th>
              <th>Location</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Next touch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.leadId}>
                <td>
                  <Link className="name" href={`/l/${r.leadId}`}>
                    {r.person.name || "(unknown person)"}
                  </Link>
                  {r.person.role ? <div className="sub">{r.person.role}</div> : null}
                </td>
                <td>
                  <Link href={`/c/${r.company.slug}`}>{r.company.name}</Link>
                  {r.company.oneLiner ? <div className="sub">{r.company.oneLiner}</div> : null}
                </td>
                <td className="num">{r.company.batch || "—"}</td>
                <td className="sub">{(r.company.location || "—").split(",").slice(0, 2).join(",")}</td>
                <td className="num">
                  {r.company.hiring?.roles?.length ? r.company.hiring.roles.length : r.company.hiring ? "0" : "—"}
                </td>
                <td>{statusChip(r.status)}</td>
                <td className="num">{r.nextTouch || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
