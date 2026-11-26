import { prisma } from "./db";
import { indexRepo, type Chunk } from "./indexer";
import { BM25, tokenize } from "./bm25";
import { ensureEmbeddings, vectorSearch } from "./vector";

type DbChunk = Chunk & { id: number };

let chunks: DbChunk[] | null = null;
let bm25: BM25 | null = null;

async function loadFromDb(): Promise<DbChunk[]> {
  return prisma.chunk.findMany({
    orderBy: { id: "asc" },
    select: { id: true, path: true, startLine: true, endLine: true, content: true },
  });
}

async function indexToDb(): Promise<DbChunk[]> {
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
  bm25?: number;
  vec?: number;
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

/** 纯 BM25 检索（保留，用来做对照） */
export async function bm25Search(query: string, topK = 5): Promise<SearchHit[]> {
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

/**
 * search_code 路由：
 * - 符号查询（readFileTool）→ 纯 BM25，快且准，不调 embedding
 * - 自然语言 → 混合检索
 * 依据：50 条评测里符号题 BM25 hit@5 0.967，且 embedding 网络抖动会拖垮 8s 超时
 */
export async function searchCode(query: string, topK = 5): Promise<SearchHit[]> {
  if (isIdentifierQuery(query)) return bm25Search(query, topK);
  return hybridSearch(query, topK);
}

/**
 * 源码优先：查实现时，lib/ 下的代码比 README / test route 更该被回答。
 * 这是启发式，不是真理；真实系统会用 query intent 分类。
 */
function isIdentifierQuery(q: string): boolean {
  const t = q.trim();
  return /^[A-Za-z_$][\w$.-]*$/.test(t) && !/\s/.test(t);
}

/**
 * 混合检索：BM25 + 向量，用 RRF 融合。
 * RRF(文档) = Σ 1 / (k + 排名)，k 常取 60。
 */
export async function hybridSearch(query: string, topK = 5) {
  await ensureIndex();
  await ensureEmbeddings();

  // 1. BM25 排名
  const bm25Ranked = bm25!
    .score(tokenize(query))
    .map((h) => ({
      dbId: chunks![h.id].id,
      score: h.score + definitionBonus(chunks![h.id], query),
    }))
    .sort((a, b) => b.score - a.score);

  // 2. 向量排名
  const vecRanked = await vectorSearch(query, 50);

  // 3. RRF 融合
  const K = 60;
  const fused = new Map<number, { rrf: number; bm25?: number; vec?: number }>();

  const bm25W = isIdentifierQuery(query) ? 2 : 1;
  const vecW = isIdentifierQuery(query) ? 1 : 3;

  bm25Ranked.forEach((h, i) => {
    const cur = fused.get(h.dbId) ?? { rrf: 0 };
    cur.rrf += bm25W / (K + i + 1);
    cur.bm25 = h.score;
    fused.set(h.dbId, cur);
  });

  vecRanked.forEach((h, i) => {
    const cur = fused.get(h.id) ?? { rrf: 0 };
    cur.rrf += vecW / (K + i + 1);
    cur.vec = h.score;
    fused.set(h.id, cur);
  });

  const items = [...fused.entries()].map(([id, s]) => {
    const c = chunks!.find((x) => x.id === id)!;
    return { c, s, final: s.rrf };
  });

  items.sort((a, b) => b.final - a.final);

  return items.slice(0, topK).map(({ c, s, final }) => ({
    path: c.path,
    startLine: c.startLine,
    endLine: c.endLine,
    score: Number(final.toFixed(4)),
    bm25: s.bm25 !== undefined ? Number(s.bm25.toFixed(3)) : undefined,
    vec: s.vec !== undefined ? Number(s.vec.toFixed(3)) : undefined,
    snippet: c.content.slice(0, 300),
  }));
}
