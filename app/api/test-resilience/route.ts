import { NextRequest } from "next/server";
import { fitMessages, withTimeout } from "@/lib/resilience";
import type { ChatMessage } from "@/lib/agent";

/**
 * /api/test-resilience?mode=timeout  测超时
 * /api/test-resilience?mode=fit      测上下文裁剪
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") ?? "timeout";

  if (mode === "timeout") {
    const start = Date.now();
    try {
      await withTimeout(
        new Promise((resolve) => setTimeout(resolve, 2000)),
        300,
        "slow_tool",
      );
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json({
        error: String(err),
        elapsedMs: Date.now() - start,
      });
    }
  }

  const big: ChatMessage[] = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 60; i++) {
    big.push({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(2000),
    });
  }

  const fitted = fitMessages(big, 12000);

  return Response.json({
    before: big.length,
    after: fitted.length,
    firstNonSystemRole: fitted[1]?.role,
    trimmed: fitted.length < big.length,
  });
}
