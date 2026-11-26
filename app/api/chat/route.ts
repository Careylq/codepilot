import { NextRequest } from "next/server";
import { runAgentStream } from "@/lib/agent-stream";
import type { ChatMessage } from "@/lib/types";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeRepo } from "@/lib/repos";

export const runtime = "nodejs";
export const maxDuration = 60;

const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function POST(req: NextRequest) {
  const rl = rateLimit(`chat:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: `请求过于频繁，请 ${rl.retryAfter}s 后再试` },
      { status: 429 },
    );
  }

  const body = (await req.json()) as {
    messages?: ChatMessage[];
    sessionId?: string;
    repo?: string;
  };

  const messages = body.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages 不能为空" }, { status: 400 });
  }

  const sessionId =
    typeof body.sessionId === "string" && SESSION_RE.test(body.sessionId)
      ? body.sessionId
      : undefined;

  const repo = normalizeRepo(body.repo);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      try {
        const result = await runAgentStream(
          messages,
          {
            onStep: (step) => send("step", { step }),
            onToken: (text) => send("token", { text }),
            onToolCall: (name, args) => send("tool_call", { name, args }),
            onToolResult: (name, ok, preview) =>
              send("tool_result", { name, ok, preview }),
          },
          sessionId,
          repo,
          req.signal,
        );
        send("done", result);
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
