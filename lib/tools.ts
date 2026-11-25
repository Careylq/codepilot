import { readFile } from "node:fs/promises";
import path from "node:path";
import { searchCode } from "./search";

export type ToolResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema，告诉模型参数长什么样 */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
};

const ROOT = process.cwd();
const MAX_CHARS = 20000;

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "读取仓库内一个文件的完整内容。当需要查看某个文件的具体实现、配置或依赖时使用。",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "相对于仓库根目录的文件路径，例如 package.json 或 app/page.tsx",
      },
    },
    required: ["path"],
  },
  async execute(args) {
    const rel = String(args.path ?? "").trim();
    if (!rel) return { ok: false, error: "缺少 path 参数" };

    const abs = path.resolve(ROOT, rel);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
      return { ok: false, error: "拒绝：路径越界" };
    }

    try {
      const content = await readFile(abs, "utf8");

      let out = content;
      if (content.length > MAX_CHARS) {
        out =
          content.slice(0, MAX_CHARS) +
          `\n\n（内容已截断，原文件共 ${content.length} 字符）`;
      }

      return { ok: true, content: out };
    } catch (err) {
      return { ok: false, error: `读取失败：${String(err)}` };
    }
  },
};

export const searchCodeTool: Tool = {
  name: "search_code",
  description:
    "在仓库里按关键词搜索代码，返回最相关的文件路径、行号和代码片段。当不知道某个函数、变量或功能在哪个文件时使用。",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "要搜索的关键词或函数名，例如 readFileTool、agent loop",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, error: "缺少 query 参数" };

    const hits = await searchCode(query, 5);
    if (hits.length === 0) return { ok: true, content: "没有找到匹配结果" };

    return {
      ok: true,
      content: hits
        .map(
          (h) =>
            `${h.path}:${h.startLine}-${h.endLine}  (score ${h.score})\n${h.snippet}`,
        )
        .join("\n\n---\n\n"),
    };
  },
};

/** 所有可用工具，agent loop 会从这里查 */
export const tools: Tool[] = [readFileTool, searchCodeTool];

export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}

/** 转成模型能看懂的格式（OpenAI tools 格式） */
export function toModelTools() {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
