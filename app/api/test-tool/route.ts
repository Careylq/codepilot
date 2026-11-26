import { NextRequest } from "next/server";
import { readFileTool } from "@/lib/tools";
import { devOnly } from "@/lib/dev-only";

/**
 * 手动测试工具用：
 *   /api/test-tool?path=package.json
 *   /api/test-tool?path=../../etc/passwd
 */
export async function GET(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const p = req.nextUrl.searchParams.get("path") ?? "package.json";
  const result = await readFileTool.execute({ path: p }, { repo: "codepilot" });

  if (result.ok) {
    return Response.json({
      ok: true,
      length: result.content.length,
      preview: result.content.slice(0, 300),
    });
  }
  return Response.json(result, { status: 400 });
}
