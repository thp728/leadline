import { listLeads, stats } from "../../../lib/store.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rows = listLeads({
    status: searchParams.get("status") || undefined,
    q: searchParams.get("q") || undefined,
    source: searchParams.get("source") || undefined,
    hasRoles: searchParams.get("roles") === "1",
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });

  return Response.json({ stats: stats(), leads: rows });
}
