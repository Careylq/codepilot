import path from "node:path";
import { Node, Project, ts } from "ts-morph";

export type AstChunk = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  symbol?: string;
  kind?: string;
};

const AST_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const MAX_LINES = 160;
const OVERLAP = 10;
const GAP_MIN_LINES = 3;

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022,
  },
});

export function supportsAst(filePath: string): boolean {
  return AST_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * 按函数 / 类 / 接口 / 类型 / 变量声明切分。
 * 没有被声明覆盖的行（imports、顶层调用、export default）合并成 (module) 块。
 * 解析失败或没有声明时返回 null，由调用方回退到行窗口。
 */
export function astChunks(filePath: string, text: string): AstChunk[] | null {
  if (!supportsAst(filePath)) return null;

  let source;
  try {
    source = project.createSourceFile(filePath, text, { overwrite: true });
  } catch {
    return null;
  }

  const lines = text.split("\n");
  const raw: AstChunk[] = [];

  const push = (start: number, end: number, symbol: string, kind: string) => {
    if (end < start) return;
    raw.push({
      path: filePath,
      startLine: start,
      endLine: end,
      content: lines.slice(start - 1, end).join("\n"),
      symbol,
      kind,
    });
  };

  const addNode = (node: Node, name: string, kind: string) => {
    const start = node.getStartLineNumber();
    const end = node.getEndLineNumber();
    const total = end - start + 1;

    if (total <= MAX_LINES) {
      push(start, end, name, kind);
      return;
    }

    for (let s = start; s <= end; s += MAX_LINES - OVERLAP) {
      const e = Math.min(s + MAX_LINES - 1, end);
      push(s, e, name, kind);
      if (e === end) break;
    }
  };

  try {
    for (const stmt of source.getStatements()) {
      if (
        Node.isFunctionDeclaration(stmt) ||
        Node.isClassDeclaration(stmt) ||
        Node.isInterfaceDeclaration(stmt) ||
        Node.isTypeAliasDeclaration(stmt) ||
        Node.isEnumDeclaration(stmt)
      ) {
        addNode(stmt, stmt.getName() ?? "(anonymous)", stmt.getKindName());
        continue;
      }

      if (Node.isVariableStatement(stmt)) {
        for (const decl of stmt.getDeclarations()) {
          addNode(decl, decl.getName(), "VariableDeclaration");
        }
      }
    }
  } finally {
    project.removeSourceFile(source);
  }

  if (raw.length === 0) return null;

  raw.sort((a, b) => a.startLine - b.startLine);

  const covered = new Set<number>();
  for (const c of raw) {
    for (let l = c.startLine; l <= c.endLine; l++) covered.add(l);
  }

  const gaps: AstChunk[] = [];
  let gapStart: number | null = null;

  const flush = (end: number) => {
    if (gapStart === null) return;
    if (end - gapStart + 1 >= GAP_MIN_LINES) {
      gaps.push({
        path: filePath,
        startLine: gapStart,
        endLine: end,
        content: lines.slice(gapStart - 1, end).join("\n"),
        symbol: "(module)",
        kind: "Module",
      });
    }
    gapStart = null;
  };

  for (let l = 1; l <= lines.length; l++) {
    if (!covered.has(l)) {
      if (gapStart === null) gapStart = l;
    } else {
      flush(l - 1);
    }
  }
  flush(lines.length);

  return [...raw, ...gaps].sort((a, b) => a.startLine - b.startLine);
}

/** 非 AST 文件的回退：固定行窗口 */
export function lineChunks(
  filePath: string,
  text: string,
  chunkLines = 80,
  overlap = 10,
): AstChunk[] {
  const lines = text.split("\n");
  const out: AstChunk[] = [];

  for (let start = 0; start < lines.length; start += chunkLines - overlap) {
    const end = Math.min(start + chunkLines, lines.length);
    out.push({
      path: filePath,
      startLine: start + 1,
      endLine: end,
      content: lines.slice(start, end).join("\n"),
      symbol: "(module)",
      kind: "Window",
    });
    if (end === lines.length) break;
  }

  return out;
}

/** Markdown 按 ## 标题切块 */
export function markdownChunks(filePath: string, text: string): AstChunk[] {
  const lines = text.split("\n");
  const out: AstChunk[] = [];
  const MAX = 160;

  const push = (start: number, end: number, title: string) => {
    if (end <= start) return;

    if (end - start <= MAX) {
      out.push({
        path: filePath,
        startLine: start + 1,
        endLine: end,
        content: lines.slice(start, end).join("\n"),
        symbol: title,
        kind: "MarkdownSection",
      });
      return;
    }

    for (let s = start; s < end; s += MAX - 20) {
      const e = Math.min(s + MAX, end);
      out.push({
        path: filePath,
        startLine: s + 1,
        endLine: e,
        content: lines.slice(s, e).join("\n"),
        symbol: title,
        kind: "MarkdownSection",
      });
      if (e === end) break;
    }
  };

  let start = 0;
  let title = "(intro)";

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]) && i > start) {
      push(start, i, title);
      start = i;
      title = lines[i].replace(/^##\s+/, "").trim();
    }
  }
  push(start, lines.length, title);

  return out;
}
