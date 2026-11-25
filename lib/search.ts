import { prisma } from "./db";
import { indexRepo, type Chunk } from "./indexer";
import { BM25, tokenize } from "./bm25";

let chunks: Chunk[] | null = null;
let bm25: BM25 | null = null;

async function loadFromDb(): Promise<Chunk[]> {
  return prisma.chunk.findMany({
    orderBy: { id: "asc" },
    select: { path: true, startLine: true, endLine: true, content: true },
  });
}

async function indexToDb(): Promise<Chunk[]> {
  const indexed = await indexRepo();
  await prisma.chunk.deleteMany();
  for (const c of indexed) {
    await prisma.chunk.create({ data: c });
  }
  return loadFromDb();
}

export async function ensureIndex() {
  if (chunks && bm25) return { count: chunks.length, source: "memory" };

  let rows = await loadFromDb();

  if (rows.length === 0) {
    rows = await indexToDb();
  }

  chunks = rows;
  bm25 = new BM25();
  for (const c of chunks) bm25.add(tokenize(`${c.path} ${c.content}`));
  bm25.finalize();

  return { count: chunks.length, source: "db" };
}

/** 重建索引（改了切分策略时用） */
export async function rebuildIndex() {
  chunks = null;
  bm25 = null;
  await indexToDb();
  return ensureIndex();
}

export type SearchHit = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * BM25 只看词频，分不清「定义」和「引用」。
 * 如果查询词正好是某个声明名（const/function/class/type），给一点奖励。
 */
function definitionBonus(chunk: Chunk, rawQuery: string): number {
  const q = rawQuery.trim();
  if (!q || /\s/.test(q)) return 0; // 多词查询不适用

  const re = new RegExp(
    `(export\\s+)?(async\\s+)?(const|let|function|class|type|interface|enum)\\s+${escapeRegExp(q)}\\b`,
    "i",
  );
  return re.test(chunk.content) ? 5 : 0;
}

/**
 * 文件名是强信号：查 "agent" 时，lib/agent.ts 应该排在 README 前面。
 */
function pathBonus(chunk: Chunk, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q || /\s/.test(q)) return 0;
  const base = chunk.path.toLowerCase().replace(/\.[^.]+$/, "");
  return base.includes(q) ? 2 : 0;
}

export async function searchCode(query: string, topK = 5): Promise<SearchHit[]> {
  await ensureIndex();

  const scored = bm25!.score(tokenize(query)).map((h) => ({
    id: h.id,
    score:
      h.score +
      definitionBonus(chunks![h.id], query) +
      pathBonus(chunks![h.id], query),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((h) => {
    const c = chunks![h.id];
    return {
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      score: Number(h.score.toFixed(3)),
      snippet: c.content.slice(0, 300),
    };
  });
}
