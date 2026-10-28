import Link from "next/link";
import { morning } from "../lib/store.mjs";
import { attemptsNewestFirst, daysBetween, isoDay } from "../lib/core.mjs";

export const dynamic = "force-dynamic";

/** The stored day is plain YYYY-MM-DD; format it as a local date, never a UTC one. */
function longDay(today) {
  const [year, month, date] = today.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function dayCount(days) {
  return days === 1 ? "1 day" : `${days} days`;
}

function overdue(dueOn, today) {
  const late = daysBetween(dueOn, today);
  return late === 0 ? "due today" : `${dayCount(late)} overdue`;
}

function LeadRow({ row, note }) {
  const companySlug = row.company.slug || row.companySlug;
  return (
    <li>
      <div className="who">
        <Link className="name" href={`/l/${row.leadId}`}>
          {row.person.name || "(unknown person)"}
        </Link>
        {row.person.role ? <span className="sub"> · {row.person.role}</span> : null}
        <div className="sub">
          <Link href={`/c/${companySlug}`}>{row.company.name || companySlug}</Link>
          {row.company.batch ? ` · ${row.company.batch}` : ""}
          {row.company.location ? ` · ${row.company.location.split(",")[0]}` : ""}
        </div>
      </div>
      <div className="when">
        <span className={`chip ${row.status}`}>{row.status}</span>
        <span className="sub">{note}</span>
      </div>
    </li>
  );
}

function CompanyRow({ row }) {
  const research = row.researchStatus || "untriaged";
  const roles = row.hiring ? row.hiring.roles?.length || 0 : null;
  return (
    <li>
      <div className="who">
        <Link className="name" href={`/c/${row.slug}`}>
          {row.name || row.slug}
        </Link>
        {row.oneLiner ? <span className="sub"> · {row.oneLiner}</span> : null}
        <div className="sub">
          {row.batch || "no batch"}
          {row.teamSize ? ` · ${row.teamSize} people` : ""}
          {row.location ? ` · ${row.location.split(",")[0]}` : ""}
        </div>
      </div>
      <div className="when">
        <span className={`chip ${research}`}>{research}</span>
        <span className="sub">{roles === null ? "no board found" : `${roles} open role${roles === 1 ? "" : "s"}`}</span>
      </div>
    </li>
  );
}

function leadNote(bucketId, row, today) {
  if (bucketId === "due") return overdue(row.dueOn, today);
  if (bucketId === "backlog") return "not contacted yet";
  const [last] = attemptsNewestFirst(row.attempts || []);
  if (!last) return "no Attempt logged";
  const waited = Math.max(0, daysBetween(last.date, today));
  return waited === 0 ? `last wrote today (${last.channel})` : `last wrote ${dayCount(waited)} ago`;
}

export default async function Morning() {
  const today = isoDay(new Date());
  const { buckets, counts } = morning(today);
  const nothingYet = counts.leads === 0 && counts.companies === 0;

  return (
    <main className="wrap">
      <div className="top">
        <div className="brand">
          <b>leadline</b> / what to do now
        </div>
        <div className="counts">
          <span>
            <b>{counts.leads}</b> leads
          </span>
          <span>
            <b>{counts.companies}</b> companies
          </span>
          <Link href="/leads">all leads →</Link>
        </div>
      </div>

      <header className="morning">
        <h1>{longDay(today)}</h1>
        <p className="hint">
          Work the buckets top to bottom. Write the message yourself and record it when you send; nothing here contacts
          anyone.
        </p>
      </header>

      {nothingYet ? (
        <div className="empty onboard">
          <p>The corpus is empty. Ingest some companies, then name a human: that is what creates a Lead.</p>
          <p>
            <code>node scripts/cli.mjs yc --limit 40</code> then{" "}
            <code>node scripts/cli.mjs add-person --company &lt;slug&gt; --name &quot;Priya Sharma&quot;</code>
          </p>
        </div>
      ) : null}

      <div className="buckets">
        {buckets.map((bucket) => (
          <section className="bucket" key={bucket.id} aria-labelledby={`bucket-${bucket.id}`}>
            <div className="bucket-head">
              <h2 id={`bucket-${bucket.id}`}>{bucket.label}</h2>
              <span className="bucket-count">{bucket.count}</span>
              <span className="bucket-note">{bucket.note}</span>
            </div>
            {bucket.count === 0 ? (
              <p className="bucket-empty">{bucket.empty}</p>
            ) : (
              <ul className="bucket-rows">
                {bucket.rows.map((row) =>
                  bucket.kind === "company" ? (
                    <CompanyRow key={row.slug} row={row} />
                  ) : (
                    <LeadRow key={row.leadId} row={row} note={leadNote(bucket.id, row, today)} />
                  ),
                )}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
