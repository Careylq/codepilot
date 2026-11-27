export type DiffFile = {
  path: string;
  hunks: string[];
  added: string[];
  removed: string[];
};

/** 从 unified diff 里提取文件、hunk 头和新增/删除行 */
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of diff.split("\n")) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);

    if (m) {
      current = { path: m[2], hunks: [], added: [], removed: [] };
      files.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("@@")) {
      current.hunks.push(line);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed.push(line.slice(1));
    }
  }

  return files;
}
