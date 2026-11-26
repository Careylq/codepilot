import { NextRequest } from "next/server";
import { embed } from "@/lib/embedding";
import { ensureEmbeddings, vectorSearch } from "@/lib/vector";
import { devOnly } from "@/lib/dev-only";

/**
 * /api/test-embed                 测维度
 * /api/test-embed?build=1         给所有 chunk 生成向量
 * /api/test-embed?q=agent loop    纯向量检索
 */
export async function GET(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const build = req.nextUrl.searchParams.get("build") === "1";
  const q = req.nextUrl.searchParams.get("q");

  try {
    if (build) {
      const result = await ensureEmbeddings();
      return Response.json({ mode: "build", ...result });
    }

    if (q) {
      const hits = await vectorSearch(q, 5);
      return Response.json({
        query: q,
        hits: hits.map((h) => ({
          path: h.path,
          startLine: h.startLine,
          endLine: h.endLine,
          score: Number(h.score.toFixed(3)),
        })),
      });
    }

    const [v] = await embed(["readFileTool"]);
    return Response.json({ dimension: v.length, sample: v.slice(0, 5) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
