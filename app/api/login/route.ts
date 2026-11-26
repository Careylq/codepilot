import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, accessToken } from "@/lib/auth-token";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const expected = process.env.ACCESS_CODE;

  // 未配置口令：本地开发直接放行
  if (!expected) return NextResponse.json({ ok: true });

  if (typeof body.code !== "string" || body.code !== expected) {
    return NextResponse.json({ error: "口令错误" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await accessToken(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
