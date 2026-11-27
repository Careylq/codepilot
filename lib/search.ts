import { prisma } from "./db";
import type { Chunk } from "./indexer";
import { BM25, tokenize } from "./bm25";
import { clearVectorCache, vectorSearch } from "./vector";

type DbChunk = Chunk & { id: number };
type RepoIndex = { chunks: DbChunk[]; bm25: BM25 };

const indexes = new Map<string, RepoIndex>();

async function loadRepo(repo: string): Promise<RepoIndex> {
  const rows = await prisma.chunk.findMany({
    where: { repo },
    orderBy: { id: "asc" },
    select: {
      id: true,
      path: true,
      startLine: true,
      endLine: true,
      content: true,
      symbol: true,
      kind: true,
    },
  });

  const bm25 = new BM25();
  for (const c of rows) bm25.add(tokenize(`${c.path} ${c.content}`));
  bm25.finalize();

  return { chunks: rows, bm25 };
}

export async function ensureIndex(repo = "codepilot") {
  const cached = indexes.get(repo);
  if (cached) return { count: cached.chunks.length, source: "memory" };

  const idx = await loadRepo(repo);
  indexes.set(repo, idx);
  return { count: idx.chunks.length, source: "db" };
}

export function clearIndexCache() {
  indexes.clear();
  clearVectorCache();
}

export type SearchHit = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  bm25?: number;
  vec?: number;
  symbol?: string | null;
  kind?: string | null;
  snippet: string;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function definitionBonus(chunk: Chunk, rawQuery: string): number {
  const q = rawQuery.trim();
  if (!q || /\s/.test(q)) return 0;

  const re = new RegExp(
    `(export\\s+)?(async\\s+)?(const|let|function|class|type|interface|enum)\\s+${escapeRegExp(q)}\\b`,
    "i",
  );
  return re.test(chunk.content) ? 5 : 0;
}

function pathBonus(chunk: Chunk, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q || /\s/.test(q)) return 0;
  const base = chunk.path.toLowerCase().replace(/\.[^.]+$/, "");
  return base.includes(q) ? 2 : 0;
}

function symbolBonus(chunk: DbChunk, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q || /\s/.test(q)) return 0;

  const sym = (chunk.symbol ?? "").toLowerCase();
  if (!sym) return 0;
  if (sym === q) return 12;
  if (sym.includes(q)) return 5;
  return 0;
}

function kindBonus(chunk: DbChunk): number {
  switch (chunk.kind) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "InterfaceDeclaration":
    case "TypeAliasDeclaration":
    case "EnumDeclaration":
      return 4;
    default:
      return 0;
  }
}

const INTENT_HINTS: { test: RegExp; hints: string[] }[] = [
  { test: /数据库|postgres|prisma|db/i, hints: ["prisma", "db", "schema"] },
  { test: /引用|citation|跳转|加载代码/i, hints: ["citation", "file", "route"] },
  { test: /多仓库|仓库隔离|repo/i, hints: ["repo", "repository", "chunk"] },
  { test: /测试|覆盖率|test/i, hints: ["test", "vitest", "package"] },
  { test: /review|审查|角色/i, hints: ["review", "planner", "reviewer"] },
];

function expandQuery(query: string): string {
  const hints = INTENT_HINTS.filter((h) => h.test.test(query)).flatMap(
    (h) => h.hints,
  );
  return hints.length > 0 ? `${query} ${hints.join(" ")}` : query;
}

function isIdentifierQuery(q: string): boolean {
  const t = q.trim();
  return /^[A-Za-z_$][\w$.-]*$/.test(t) && !/\s/.test(t);
}

/** 纯 BM25 检索 */
export async function bm25Search(
  query: string,
  topK = 5,
  repo = "codepilot",
): Promise<SearchHit[]> {
  await ensureIndex(repo);
  const idx = indexes.get(repo)!;

  const scored = idx.bm25.score(tokenize(expandQuery(query))).map((h) => ({
    id: h.id,
    score:
      h.score +
      definitionBonus(idx.chunks[h.id], query) +
      pathBonus(idx.chunks[h.id], query) +
      symbolBonus(idx.chunks[h.id], query) +
      kindBonus(idx.chunks[h.id]),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((h) => {
    const c = idx.chunks[h.id];
    return {
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      score: Number(h.score.toFixed(3)),
      symbol: c.symbol,
      kind: c.kind,
      snippet: c.content.slice(0, 300),
    };
  });
}

/** 混合检索：BM25 + 向量，加权 RRF */
export async function hybridSearch(
  query: string,
  topK = 5,
  repo = "codepilot",
  queryVec?: number[],
) {
  await ensureIndex(repo);
  const idx = indexes.get(repo)!;

  const bm25Ranked = idx.bm25
    .score(tokenize(query))
    .map((h) => ({
      dbId: idx.chunks[h.id].id,
      score:
        h.score +
        definitionBonus(idx.chunks[h.id], query) +
        symbolBonus(idx.chunks[h.id], query) +
        kindBonus(idx.chunks[h.id]),
    }))
    .sort((a, b) => b.score - a.score);

  const vecRanked = await vectorSearch(query, 50, repo, queryVec);

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
    const c = idx.chunks.find((x) => x.id === id)!;
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
    symbol: c.symbol,
    kind: c.kind,
    snippet: c.content.slice(0, 300),
  }));
}

/** search_code 路由：符号查询走 BM25，自然语言走混合 */
export async function searchCode(
  query: string,
  topK = 5,
  repo = "codepilot",
): Promise<SearchHit[]> {
  if (isIdentifierQuery(query)) return bm25Search(query, topK, repo);
  return hybridSearch(query, topK, repo);
}
