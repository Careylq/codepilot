import { NextRequest } from "next/server";
import { runReview } from "@/lib/review";
import { normalizeRepo } from "@/lib/repos";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rl = rateLimit(`review:${clientIp(req)}`, 5, 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: `请求过于频繁，请 ${rl.retryAfter}s 后再试` },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    diff?: string;
    repo?: string;
  };

  const diff = typeof body.diff === "string" ? body.diff : "";

  if (diff.trim().length < 20) {
    return Response.json({ error: "diff 太短，请粘贴完整改动" }, { status: 400 });
  }

  if (diff.length > 40000) {
    return Response.json(
      { error: "diff 太长，最多 40000 字符" },
      { status: 400 },
    );
  }

  const repo = normalizeRepo(body.repo);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

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
        const result = await runReview(diff, repo, {
          onStep: (step) => send("step", { step }),
          onPlan: (plan) => send("plan", { files: plan.files }),
          onContext: (count) => send("context", { count }),
        });

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
