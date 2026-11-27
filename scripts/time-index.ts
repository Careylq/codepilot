import "./env";
import { prisma } from "../lib/db";
import { BM25, tokenize } from "../lib/bm25";

async function main() {
  const repo = process.argv[2] ?? "zustand";
  let t = Date.now();
  const rows = await prisma.chunk.findMany({
    where: { repo },
    select: { id: true, path: true, startLine: true, endLine: true, content: true, symbol: true, kind: true },
  });
  console.log(`fetch rows: ${Date.now() - t}ms`, rows.length);

  const sizes = rows.map((r) => r.content.length);
  console.log("avg chars:", Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length), "max:", Math.max(...sizes));

  t = Date.now();
  const bm25 = new BM25();
  for (const r of rows) bm25.add(tokenize(`${r.path} ${r.content}`));
  bm25.finalize();
  console.log(`bm25 build: ${Date.now() - t}ms`);

  t = Date.now();
  const vecRows = await prisma.chunk.findMany({
    where: { repo, embedding: { not: null } },
    select: { embedding: true },
  });
  console.log(`fetch embeddings: ${Date.now() - t}ms`, vecRows.length);

  t = Date.now();
  for (const r of vecRows) JSON.parse(r.embedding!);
  console.log(`parse embeddings: ${Date.now() - t}ms`);

  await prisma.$disconnect();
}
main();
