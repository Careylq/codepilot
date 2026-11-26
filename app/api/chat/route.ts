import { NextRequest } from "next/server";
import { runAgentStream } from "@/lib/agent-stream";
import type { ChatMessage } from "@/lib/agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { messages, sessionId } = (await req.json()) as {
    messages: ChatMessage[];
    sessionId?: string;
  };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const result = await runAgentStream(messages, {
          onStep: (step) => send("step", { step }),
          onToken: (text) => send("token", { text }),
          onToolCall: (name, args) => send("tool_call", { name, args }),
          onToolResult: (name, ok, preview) =>
            send("tool_result", { name, ok, preview }),
        }, sessionId);
        send("done", result);
      } catch (err) {
        send("error", { message: String(err) });
      } finally {
        controller.close();
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
