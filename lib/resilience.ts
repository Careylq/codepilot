import type { ChatMessage } from "./types";

/** 给 Promise 加超时；超时抛错 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 超时（${ms}ms）`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 粗略估 token：中文 1 字 ≈ 1 token，英文 4 字符 ≈ 1 token */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const rest = text.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n（已截断，原长 ${text.length} 字符）`;
}

export function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content ?? "") + 20,
    0,
  );
}

/**
 * 上下文预算：超了就丢最旧的消息。
 * 注意：不能从 tool 消息开始，否则会丢掉对应的 assistant(tool_calls)。
 */
export function fitMessages(
  messages: ChatMessage[],
  maxTokens = 12000,
): ChatMessage[] {
  if (totalTokens(messages) <= maxTokens) return messages;

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  const kept: ChatMessage[] = [];
  let used = system.reduce((s, m) => s + estimateTokens(m.content ?? "") + 20, 0);

  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimateTokens(rest[i].content ?? "") + 20;
    if (used + t > maxTokens && kept.length > 0) break;
    kept.unshift(rest[i]);
    used += t;
  }

  const firstUser = kept.findIndex((m) => m.role === "user");
  const trimmed = firstUser > 0 ? kept.slice(firstUser) : kept;

  return [...system, ...trimmed];
}

/** 返回裁剪后的消息 + 被裁掉的消息（用于生成摘要） */
export function splitMessages(
  messages: ChatMessage[],
  maxTokens = 12000,
): { fitted: ChatMessage[]; dropped: ChatMessage[] } {
  const fitted = fitMessages(messages, maxTokens);
  const kept = new Set(fitted);
  const dropped = messages.filter((m) => !kept.has(m));
  return { fitted, dropped };
}
