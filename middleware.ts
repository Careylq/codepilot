import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, accessToken } from "@/lib/auth-token";

/**
 * 访问口令守卫。
 * - 未配置 ACCESS_CODE 时不拦截（本地开发）
 * - 页面未登录 → 跳 /login
 * - API 未登录 → 401
 */
export async function middleware(req: NextRequest) {
  const code = process.env.ACCESS_CODE;
  if (!code) return NextResponse.next();

  const expected = await accessToken(code);
  const ok = req.cookies.get(AUTH_COOKIE)?.value === expected;
  if (ok) return NextResponse.next();

  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未授权，请先登录" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/", "/review", "/api/chat/:path*", "/api/file/:path*", "/api/review/:path*"],
};
