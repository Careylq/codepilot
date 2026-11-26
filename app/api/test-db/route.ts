import { NextRequest } from "next/server";
import { clearIndexCache, ensureIndex } from "@/lib/search";
import { devOnly } from "@/lib/dev-only";

/**
 * /api/test-db          查看索引状态
 * /api/test-db?rebuild=1 重建索引（清空后重新写入数据库）
 */
export async function GET(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const rebuild = req.nextUrl.searchParams.get("rebuild") === "1";
  if (rebuild) clearIndexCache();
  const result = await ensureIndex();
  return Response.json(result);
}
