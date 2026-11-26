import { prisma } from "./db";
import { isSafeRepoPath } from "./fs-guard";

/**
 * 从数据库的 chunk 重建整个文件内容。
 *
 * 为什么不读磁盘：
 *   serverless（Vercel）运行时 cwd 是 /var/task，源码文件不在里面，
 *   readFile 必然 ENOENT。索引里已经有全文，直接读库更可靠。
 */
export async function getFileContent(
  rel: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const guard = isSafeRepoPath(rel);
  if (!guard.ok) return { ok: false, error: guard.error };

  const chunks = await prisma.chunk.findMany({
    where: { path: rel },
    orderBy: { startLine: "asc" },
    select: { startLine: true, endLine: true, content: true },
  });

  if (chunks.length === 0) {
    return { ok: false, error: "文件未索引，请先用 search_code 搜索" };
  }

  // 按行号重建，自动去掉 chunk 之间的重叠
  const byLine = new Map<number, string>();

  for (const chunk of chunks) {
    chunk.content.split("\n").forEach((line, i) => {
      byLine.set(chunk.startLine + i, line);
    });
  }

  const maxLine = Math.max(...byLine.keys());
  const lines = Array.from({ length: maxLine }, (_, i) => byLine.get(i + 1) ?? "");

  return { ok: true, content: lines.join("\n") };
}
