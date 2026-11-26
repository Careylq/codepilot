import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { astChunks, lineChunks, supportsAst } from "./ast-chunker";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  ".venv",
  "coverage",
  "eval",
  "repos",
  "examples",
  "benchmarks",
  "docs",
  "test",
  "tests",
]);

const IGNORE_PATH_PARTS = ["/api/test-", "/__tests__/", ".test.", ".spec."];

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
]);

export type Chunk = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  symbol?: string | null;
  kind?: string | null;
};

export async function indexRepo(root = process.cwd()): Promise<Chunk[]> {
  const chunks: Chunk[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!EXTENSIONS.has(path.extname(entry.name))) continue;
      if (IGNORE_PATH_PARTS.some((part) => full.includes(part))) continue;

      const rel = path.relative(root, full);
      const text = await readFile(full, "utf8");

      const fileChunks = supportsAst(rel)
        ? (astChunks(rel, text) ?? lineChunks(rel, text))
        : lineChunks(rel, text);

      chunks.push(...fileChunks);
    }
  }

  await walk(root);
  return chunks;
}
