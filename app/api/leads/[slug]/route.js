import { getCompany } from "../../../../lib/store.mjs";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { slug } = await params;
  const row = getCompany(slug);
  if (!row) return Response.json({ error: "not found", slug }, { status: 404 });
  return Response.json(row);
}
