import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { searchCode } from "@/lib/search";
import { getFileContent } from "@/lib/file-content";
import { normalizeRepo } from "@/lib/repos";

export const maxDuration = 60;

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
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
