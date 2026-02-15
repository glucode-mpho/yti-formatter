import { getRecentStandups } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") ?? "7");
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 7;

  const entries = await getRecentStandups(limit);
  return Response.json({ entries });
}
