import Link from "next/link";
import { listLeads, stats, STAGES } from "../lib/store.mjs";

export const dynamic = "force-dynamic";

function stageChip(stage) {
  return <span className={`chip ${stage}`}>{stage}</span>;
}

export default async function Home({ searchParams }) {
  const sp = (await searchParams) || {};
  const stage = typeof sp.stage === "string" && sp.stage ? sp.stage : undefined;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const hasRoles = sp.roles === "1";

  const rows = listLeads({ stage, q, hasRoles });
  const s = stats();

  return (
    <main className="wrap">
      <div className="top">
        <div className="brand">
          <b>leadline</b> / founder-led pipeline
        </div>
        <div className="counts">
          <span>
            <b>{s.total}</b> leads
          </span>
          <span>
            <b>{s.withRoles}</b> with open roles
          </span>
          <span>
            <b>{s.byStage.sent + s.byStage.replied + s.byStage.call}</b> in flight
          </span>
        </div>
      </div>

      <form className="filters" method="get">
        <input
          type="search"
          name="q"
          placeholder="Search company, location, batch"
          defaultValue={q || ""}
        />
        <select name="stage" defaultValue={stage || ""}>
          <option value="">Any stage</option>
          {STAGES.map((st) => (
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
        {(stage || q || hasRoles) && <Link className="hint" href="/">reset</Link>}
      </form>

      {rows.length === 0 ? (
        <div className="empty">
          <p>No leads yet.</p>
          <p>
            Ingest some: <code>npm run leads -- yc --limit 40</code> then{" "}
            <code>npm run leads -- enrich --limit 10</code>
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Batch</th>
              <th>Size</th>
              <th>Location</th>
              <th>Roles</th>
              <th>Stage</th>
              <th>Next touch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug}>
                <td>
                  <Link className="name" href={`/c/${r.slug}`}>
                    {r.name}
                  </Link>
                  {r.oneLiner ? <div className="sub">{r.oneLiner}</div> : null}
                </td>
                <td className="num">{r.batch || "—"}</td>
                <td className="num">{r.teamSize ?? "—"}</td>
                <td className="sub">{(r.location || "—").split(",").slice(0, 2).join(",")}</td>
                <td className="num">
                  {r.hiring?.roles?.length ? r.hiring.roles.length : r.hiring ? "0" : "—"}
                </td>
                <td>{stageChip(r.outreach?.stage || "sourced")}</td>
                <td className="num">{r.outreach?.nextTouch || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
