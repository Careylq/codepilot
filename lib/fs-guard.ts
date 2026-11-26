import path from "node:path";

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".md",
  ".prisma",
]);

const DENY_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".venv",
  "eval",
]);

/**
 * 统一的仓库文件访问守卫。
 * 规则：
 * 1. 必须落在仓库根目录内（防 ../ 越界）
 * 2. 不允许隐藏文件/隐藏目录（防 .env.local）
 * 3. 不允许 .db 文件（防 dev.db）
 * 4. 只允许代码/文本扩展名
 */
export function isSafeRepoPath(
  rel: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (!rel || rel.includes("\0")) {
    return { ok: false, error: "拒绝：非法路径" };
  }

  const root = process.cwd();
  const abs = path.resolve(root, rel);

  // 1. 越界
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return { ok: false, error: "拒绝：路径越界" };
  }

  const relative = path.relative(root, abs);
  const segments = relative.split(path.sep);

  // 2. 隐藏文件/目录（.env、.env.local、.git 等）
  if (segments.some((s) => s.startsWith("."))) {
    return { ok: false, error: "拒绝：不允许访问隐藏文件" };
  }

  // 3. 敏感目录
  if (segments.some((s) => DENY_SEGMENTS.has(s))) {
    return { ok: false, error: "拒绝：该目录不允许访问" };
  }

  // 4. 数据库文件
  if (path.basename(abs).toLowerCase().endsWith(".db")) {
    return { ok: false, error: "拒绝：数据库文件不允许访问" };
  }

  // 5. 扩展名白名单
  if (!ALLOWED_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
    return { ok: false, error: "拒绝：只允许读取代码/文本文件" };
  }

  return { ok: true, abs };
}
