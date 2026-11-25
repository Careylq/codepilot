import { NextRequest } from "next/server";
import { bm25Search, hybridSearch } from "@/lib/search";
import { vectorSearch } from "@/lib/vector";

/**
 * 三路对比：
 *   /api/test-hybrid?q=agent loop
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "agent loop";

  try {
    const [b, v, h] = await Promise.all([
      bm25Search(q, 3),
      vectorSearch(q, 3),
      hybridSearch(q, 3),
    ]);

    const fmt = (arr: { path: string; startLine: number; score: number }[]) =>
      arr.map((x) => `${x.path}:${x.startLine} (${x.score})`);

    return Response.json({
      query: q,
      bm25: fmt(b),
      vector: fmt(v),
      hybrid: fmt(h),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
