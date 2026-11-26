/**
 * 测试/调试路由只在开发环境可用。
 * 生产环境返回 404，避免公开暴露重建索引、跑评测等烧钱接口。
 */
export function devOnly(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}
