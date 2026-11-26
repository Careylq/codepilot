/**
 * 访问口令的 token 计算。
 * 同时适用于 Edge（middleware）和 Node（route handler）：只用 Web Crypto。
 */
export async function accessToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`codepilot:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const AUTH_COOKIE = "cp_auth";
