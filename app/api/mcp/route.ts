import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { searchCode } from "@/lib/search";
import { getFileContent } from "@/lib/file-content";
import { normalizeRepo } from "@/lib/repos";

export const maxDuration = 60;

/**
 * 常量时间风格的字符串比较，降低通过响应时间猜测 token 的风险。
 * 说明：JS 无法保证严格常量时间，这里避免提前返回，做到「近似」常量时间。
 */
function safeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  for (let i = 0; i < maxLength; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return diff === 0;
}

/** MCP_TOKEN 未配置时只警告一次，避免每次请求刷日志。 */
let warnedMissingMcpToken = false;

/**
 * 校验 Bearer token。
 * - 未设置 MCP_TOKEN：放行（本地开发），打印一次警告。
 * - 已设置：要求 `Authorization: Bearer <MCP_TOKEN>`，否则拒绝。
 */
function isAuthorized(req: Request): boolean {
  const token = process.env.MCP_TOKEN;

  if (!token) {
    if (!warnedMissingMcpToken) {
      warnedMissingMcpToken = true;
      console.warn(
        "[codepilot] MCP_TOKEN 未设置：/api/mcp 未启用 Bearer 校验（仅限本地开发）。",
      );
    }
    return true;
  }

  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match) return false;

  return safeEqual(match[1].trim(), token);
}

function unauthorized(): Response {
  return Response.json({ error: "未授权" }, { status: 401 });
}

const repoEnum = z.enum(["codepilot", "zustand"]);

function createServer() {
  const server = new McpServer({
    name: "codepilot",
    version: "0.1.0",
  });

  server.tool(
    "search_code",
    "在代码仓库里搜索，返回文件:行号、symbol 和代码片段",
    { query: z.string(), repo: repoEnum.optional() },
    async ({ query, repo }) => {
      const hits = await searchCode(query, 5, normalizeRepo(repo));
      const text =
        hits
          .map(
            (h) =>
              `${h.path}:${h.startLine}-${h.endLine}${h.symbol ? ` [${h.symbol}]` : ""}\n${h.snippet}`,
          )
          .join("\n\n") || "没有找到";

      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "read_file",
    "读取仓库内一个文件的完整内容",
    { path: z.string(), repo: repoEnum.optional() },
    async ({ path, repo }) => {
      const file = await getFileContent(path, normalizeRepo(repo));

      if (!file.ok) {
        return {
          content: [{ type: "text" as const, text: `错误：${file.error}` }],
          isError: true,
        };
      }

      return { content: [{ type: "text" as const, text: file.content }] };
    },
  );

  return server;
}

async function handle(req: Request) {
  const server = createServer();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  return handle(req);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  return handle(req);
}

export async function DELETE(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  return handle(req);
}
