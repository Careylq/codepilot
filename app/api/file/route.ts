import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path") ?? "";
  const line = Math.max(1, Number(req.nextUrl.searchParams.get("line") ?? "1"));

  if (!p) return Response.json({ error: "缺少 path" }, { status: 400 });

  const abs = path.resolve(ROOT, p);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    return Response.json({ error: "拒绝：路径越界" }, { status: 400 });
  }

  try {
    const text = await readFile(abs, "utf8");
    const all = text.split("\n");
    const start = Math.max(1, line - 8);
    const end = Math.min(all.length, line + 14);

    return Response.json({
      path: p,
      line,
      start,
      end,
      lines: all.slice(start - 1, end).map((t, i) => ({ n: start + i, t })),
    });
  } catch (err) {
    return Response.json({ error: `读取失败：${String(err)}` }, { status: 404 });
  }
}
