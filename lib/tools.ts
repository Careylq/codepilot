import { readFile } from "node:fs/promises";
import path from "node:path";

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

    // 路径安全：把相对路径解析成绝对路径，必须落在仓库根目录内
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


      // TODO 2：内容超过 MAX_CHARS 时截断
      // 要求：只保留前 MAX_CHARS 个字符，并在末尾追加一行提示，例如：
      //   "\n\n（内容已截断，原文件共 N 字符）"
      // 提示：content.length 是字符数；用 slice 截断

    } catch (err) {
      return { ok: false, error: `读取失败：${String(err)}` };
    }
  },
};

/** 所有可用工具，后面 agent loop 会从这里查 */
export const tools: Tool[] = [readFileTool];

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
