import { NextRequest } from "next/server";
import { bm25Search, hybridSearch } from "@/lib/search";
import { vectorSearch } from "@/lib/vector";
import questions from "@/eval/questions.json";

export const runtime = "nodejs";
export const maxDuration = 300;

type Q = {
  id: string;
  question: string;
  expectedPaths: string[];
  type: string;
};

function rankOf(hits: { path: string }[], expected: string[]): number {
  const i = hits.findIndex((h) => expected.includes(h.path));
  return i === -1 ? 0 : i + 1;
}

function metrics(ranks: number[]) {
  const n = ranks.length || 1;
  const hit = ranks.filter((r) => r > 0 && r <= 5).length / n;
  const mrr = ranks.reduce((s, r) => s + (r > 0 ? 1 / r : 0), 0) / n;
  return { hit5: Number(hit.toFixed(3)), mrr: Number(mrr.toFixed(3)) };
}

/**
 * /api/eval?limit=50  跑评测
 */
export async function GET(req: NextRequest) {
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "0");
  const limit = limitParam > 0 ? limitParam : questions.length;
  const qs = (questions as Q[]).slice(0, limit);

  const rows = [];

  for (const q of qs) {
    const [b, v, h] = await Promise.all([
      bm25Search(q.question, 5),
      vectorSearch(q.question, 5),
      hybridSearch(q.question, 5),
    ]);

    rows.push({
      id: q.id,
      type: q.type,
      question: q.question,
      expected: q.expectedPaths,
      bm25Rank: rankOf(b, q.expectedPaths),
      vectorRank: rankOf(v, q.expectedPaths),
      hybridRank: rankOf(h, q.expectedPaths),
      bm25Top: b[0]?.path ?? null,
      vectorTop: v[0]?.path ?? null,
      hybridTop: h[0]?.path ?? null,
    });
  }

  const summary = {
    n: rows.length,
    bm25: metrics(rows.map((r) => r.bm25Rank)),
    vector: metrics(rows.map((r) => r.vectorRank)),
    hybrid: metrics(rows.map((r) => r.hybridRank)),
  };

  return Response.json({ summary, rows });
}
