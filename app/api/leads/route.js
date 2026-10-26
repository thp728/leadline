import { listLeads, stats } from "../../../lib/store.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rows = listLeads({
    stage: searchParams.get("stage") || undefined,
    q: searchParams.get("q") || undefined,
    source: searchParams.get("source") || undefined,
    hasRoles: searchParams.get("roles") === "1",
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });

  return Response.json({
    stats: stats(),
    leads: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      website: r.website,
      batch: r.batch,
      teamSize: r.teamSize,
      stage: r.stage,
      location: r.location,
      openRoles: r.hiring?.roles?.length ?? null,
      ats: r.hiring ? `${r.hiring.ats}:${r.hiring.boardId}` : null,
      outreach: r.outreach,
      sources: r.sources,
    })),
  });
}
