type Bucket = { count: number; reset: number };

const buckets = new Map<string, Bucket>();

/**
 * 极简内存限流（按实例）。
 * 注意：serverless 多实例下不是全局精确，demo 够用；生产建议换 Upstash Redis。
 */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.reset - now) / 1000) };
  }

  bucket.count++;
  return { ok: true, retryAfter: 0 };
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}
