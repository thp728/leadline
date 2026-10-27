import { slugify, upsertCompany, loadDb } from "./store.mjs";

/**
 * Sources write into the owned corpus (data/). Nothing here runs in the
 * request path of the UI: the app reads db.json, the CLI does the fetching.
 *
 * v0 ships one source (YC) plus ATS enrichment. Add adapters only when a
 * specific gap bites; a "multi-source framework" is how this stalls.
 */

const UA = { "user-agent": "leadline/0.1 (personal job-search research)" };
const TIMEOUT_MS = 12000;

async function get(url, opts = {}) {
  const res = await fetch(url, {
    headers: { ...UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || TIMEOUT_MS),
    redirect: "follow",
  });
  return res;
}

async function getJson(url) {
  const res = await get(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const INDIA = /india|bengaluru|bangalore|mumbai|new delhi|gurgaon|gurugram|hyderabad|pune|chennai|noida|ahmedabad/i;

function batchOf(batch) {
  const m = String(batch || "").match(/(Winter|Spring|Summer|Fall)?\s*(\d{4})/i);
  if (!m) return { batchYear: 0, batchSeason: "" };
  return { batchYear: Number(m[2]), batchSeason: (m[1] || "").toLowerCase() };
}

export function normalizeWebsite(site) {
  if (!site) return "";
  const s = String(site).trim();
  return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, "") : `https://${s.replace(/\/+$/, "")}`;
}

/**
 * YC directory mirror (community Algolia export, refreshed daily).
 * Free, keyless, and includes isHiring/team_size/stage, which is most of the
 * qualification work already done for us.
 */
export async function ycSource({ min = 5, max = 150, loc = "india", limit = 40, hiring = true } = {}) {
  const list = await getJson("https://yc-oss.github.io/api/companies/hiring.json");
  const rows = Array.isArray(list) ? list : list.companies || [];
  const existing = loadDb().companies;
  const existingDomains = new Set(
    Object.values(existing)
      .map((c) => (c.website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0].toLowerCase())
      .filter(Boolean),
  );

  const matched = rows.filter((c) => {
    const size = Number(c.team_size || 0);
    if (size < min || size > max) return false;
    if (hiring && c.isHiring === false) return false;
    if (loc === "india") {
      const inIndia = INDIA.test(c.all_locations || "") || (c.regions || []).some((r) => /india|south asia/i.test(r));
      if (!inIndia) return false;
    }
    const domain = normalizeWebsite(c.website)
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
    if (domain && existingDomains.has(domain)) return false;
    return true;
  });

  const picked = matched
    .slice()
    .sort((a, b) => {
      const ay = Number(String(a.batch || "").match(/(\d{4})/)?.[1] || 0);
      const by = Number(String(b.batch || "").match(/(\d{4})/)?.[1] || 0);
      return by - ay;
    })
    .slice(0, limit);
  const saved = [];
  for (const c of picked) {
    const batch = batchOf(c.batch);
    saved.push(
      upsertCompany({
        slug: slugify(c.name),
        name: c.name,
        website: normalizeWebsite(c.website),
        batch: c.batch || null,
        ...batch,
        teamSize: c.team_size || null,
        stage: c.stage || null,
        location: c.all_locations || null,
        regions: c.regions || [],
        oneLiner: c.one_liner || null,
        tags: c.tags || [],
        sources: [
          {
            source: "yc",
            url: c.url || `https://www.ycombinator.com/companies/${c.slug}`,
          },
        ],
      }),
    );
  }
  return { matched: matched.length, saved: saved.map((c) => c.slug) };
}

const ATS_PATTERNS = [
  { kind: "greenhouse", re: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { kind: "greenhouse", re: /greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]+)/i },
  { kind: "ashby", re: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
  { kind: "lever", re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { kind: "workable", re: /apply\.workable\.com\/([a-z0-9_-]+)/i },
  { kind: "recruitee", re: /([a-z0-9-]+)\.recruitee\.com/i },
];

export function detectAts(html) {
  for (const { kind, re } of ATS_PATTERNS) {
    const m = html.match(re);
    if (m) return { ats: kind, boardId: m[1] };
  }
  return null;
}

async function rolesFor(ats, boardId) {
  const urls = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${boardId}/jobs?content=false`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${boardId}`,
    lever: `https://api.lever.co/v0/postings/${boardId}?mode=json`,
  };
  const url = urls[ats];
  if (!url) return null;
  const res = await get(url);
  if (!res.ok) return null;
  const json = await res.json();
  const list = json.jobs || json || [];

  return list.map((r) => ({
    title: r.title || r.text || "Untitled",
    location: r.location?.name || r.location || r.categories?.location || r.secondaryLocations?.join(", ") || null,
    url: r.absolute_url || r.hostedUrl || r.applyUrl || null,
    publishedAt: r.updated_at || r.publishedAt || r.createdAt || null,
  }));
}

/**
 * Probe a company for a public job board and pull its roles. Tries the root,
 * then /careers and /jobs, because most small teams link the board from one
 * of those rather than embedding it on the homepage.
 */
export async function enrichCompany(slug) {
  const db = loadDb();
  const c = db.companies[slug];
  if (!c) throw new Error(`unknown company: ${slug}`);
  const base = normalizeWebsite(c.website);
  const tried = [];
  let found = null;

  for (const url of [base, `${base}/careers`, `${base}/jobs`, `${base}/careers/`]) {
    try {
      const res = await get(url);
      tried.push({ url, status: res.status });
      if (!res.ok) continue;
      const html = await res.text();
      found = detectAts(html);
      if (found) {
        found.foundOn = url;
        break;
      }
    } catch (err) {
      tried.push({ url, error: String(err.message || err).slice(0, 80) });
    }
  }

  let roles = null;
  if (found) {
    try {
      roles = await rolesFor(found.ats, found.boardId);
    } catch (err) {
      tried.push({ url: `${found.ats}:${found.boardId}`, error: String(err.message || err).slice(0, 80) });
    }
  }

  const hiring = found
    ? {
        ats: found.ats,
        boardId: found.boardId,
        foundOn: found.foundOn,
        roles: roles || [],
        fetchedAt: new Date().toISOString(),
      }
    : null;

  const updated = upsertCompany({
    ...c,
    slug,
    hiring: hiring || c.hiring || null,
    lastProbedAt: new Date().toISOString(),
    probeLog: tried.slice(-6),
    sources: found
      ? [{ source: `ats:${found.ats}`, url: found.foundOn }]
      : [{ source: "probe", url: base }],
  });

  return {
    slug,
    name: c.name,
    ats: hiring?.ats || null,
    openRoles: hiring?.roles?.length || 0,
    tried,
  };
}
