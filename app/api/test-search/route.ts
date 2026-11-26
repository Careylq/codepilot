import { NextRequest } from "next/server";
import { ensureIndex, searchCode } from "@/lib/search";
import { devOnly } from "@/lib/dev-only";

/**
 * 手动测试检索：
 *   /api/test-search?q=readFileTool
 *   /api/test-search?q=agent loop
 */
export async function GET(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const q = req.nextUrl.searchParams.get("q") ?? "readFileTool";
  const { count } = await ensureIndex();
  const hits = await searchCode(q, 5);

  return Response.json({ query: q, chunks: count, hits });
}
