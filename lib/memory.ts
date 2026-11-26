import { prisma } from "./db";
import type { ChatMessage } from "./agent";

export async function getMemory(sessionId: string): Promise<string | null> {
  const row = await prisma.memory.findUnique({ where: { sessionId } });
  return row?.summary ?? null;
}

export async function saveMemory(sessionId: string, summary: string) {
  await prisma.memory.upsert({
    where: { sessionId },
    create: { sessionId, summary },
    update: { summary },
  });
}

/** 把一段被裁掉的对话压缩成摘要（一次额外模型调用） */
export async function summarize(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.MODEL ?? "deepseek-chat";

  if (!apiKey) return "";

  const text = messages
    .map((m) => `${m.role}: ${m.content ?? ""}`)
    .join("\n")
    .slice(0, 8000);

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "把对话压缩成 200 字以内的摘要，保留：用户目标、已确认的事实、未完成事项。只输出摘要，不要寒暄。",
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!res.ok) return "";
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
