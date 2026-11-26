import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

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
  ".json",
  ".css",
]);

export type Chunk = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
};

/** 每块多少行、块之间重叠多少行 */
const CHUNK_LINES = 80;
const OVERLAP_LINES = 10;

export async function indexRepo(root = process.cwd()): Promise<Chunk[]> {
  const chunks: Chunk[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过隐藏文件和忽略目录
      if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!EXTENSIONS.has(path.extname(entry.name))) continue;
      if (IGNORE_PATH_PARTS.some((part) => full.includes(part))) continue;

      const text = await readFile(full, "utf8");
      const lines = text.split("\n");

      // 按滑动窗口切分
      for (let start = 0; start < lines.length; start += CHUNK_LINES - OVERLAP_LINES) {
        const end = Math.min(start + CHUNK_LINES, lines.length);
        chunks.push({
          path: path.relative(root, full),
          startLine: start + 1,
          endLine: end,
          content: lines.slice(start, end).join("\n"),
        });
        if (end === lines.length) break;
      }
    }
  }

  await walk(root);
  return chunks;
}
