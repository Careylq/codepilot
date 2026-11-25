import { NextRequest } from "next/server";
import { readFileTool } from "@/lib/tools";

/**
 * 手动测试工具用：
 *   /api/test-tool?path=package.json
 *   /api/test-tool?path=../../etc/passwd
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path") ?? "package.json";
  const result = await readFileTool.execute({ path: p });

  if (result.ok) {
    return Response.json({
      ok: true,
      length: result.content.length,
      preview: result.content.slice(0, 300),
    });
  }
  return Response.json(result, { status: 400 });
}
