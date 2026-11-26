import { NextRequest } from "next/server";
import { getFileContent } from "@/lib/file-content";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const rl = rateLimit(`file:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: `请求过于频繁，请 ${rl.retryAfter}s 后再试` },
      { status: 429 },
    );
  }

  const p = req.nextUrl.searchParams.get("path") ?? "";
  const line = Math.max(1, Number(req.nextUrl.searchParams.get("line") ?? "1"));

  if (!p) return Response.json({ error: "缺少 path" }, { status: 400 });

  const file = await getFileContent(p);
  if (!file.ok) {
    return Response.json({ error: file.error }, { status: 404 });
  }

  const all = file.content.split("\n");
  const start = Math.max(1, line - 8);
  const end = Math.min(all.length, line + 14);

  return Response.json({
    path: p,
    line,
    start,
    end,
    lines: all.slice(start - 1, end).map((t, i) => ({ n: start + i, t })),
  });
}
