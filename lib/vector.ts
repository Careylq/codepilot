import { prisma } from "./db";
import { cosine, embed } from "./embedding";

const BATCH_SIZE = 16;

/** 给还没有向量的 chunk 生成向量，写入数据库 */
export async function ensureEmbeddings() {
  const missing = await prisma.chunk.findMany({
    where: { embedding: null },
    select: { id: true, path: true, content: true },
    orderBy: { id: "asc" },
  });

  if (missing.length === 0) {
    const total = await prisma.chunk.count({ where: { embedding: { not: null } } });
    return { embedded: total, added: 0 };
  }

  let added = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const vectors = await embed(
      batch.map((c) => `${c.path}\n${c.content}`),
    );

    for (let j = 0; j < batch.length; j++) {
      await prisma.chunk.update({
        where: { id: batch[j].id },
        data: { embedding: JSON.stringify(vectors[j]) },
      });
      added++;
    }
  }

  const total = await prisma.chunk.count({ where: { embedding: { not: null } } });
  return { embedded: total, added };
}

export type VectorHit = {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
};

const queryCache = new Map<string, number[]>();

async function embedQuery(query: string): Promise<number[]> {
  const cached = queryCache.get(query);
  if (cached) return cached;
  const [vec] = await embed([query]);
  if (queryCache.size > 200) queryCache.clear();
  queryCache.set(query, vec);
  return vec;
}

export async function vectorSearch(query: string, topK = 5): Promise<VectorHit[]> {
  const q = await embedQuery(query);

  const rows = await prisma.chunk.findMany({
    where: { embedding: { not: null } },
    select: {
      id: true,
      path: true,
      startLine: true,
      endLine: true,
      content: true,
      embedding: true,
    },
  });

  const scored = rows.map((r) => ({
    id: r.id,
    path: r.path,
    startLine: r.startLine,
    endLine: r.endLine,
    content: r.content,
    score: cosine(q, JSON.parse(r.embedding!) as number[]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
