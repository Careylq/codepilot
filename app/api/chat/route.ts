import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Msg = { role: "user" | "assistant" | "system"; content: string };

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as { messages: Msg[] };

  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.MODEL ?? "deepseek-chat";

  if (!apiKey) {
    return Response.json(
      { error: "缺少 OPENAI_API_KEY，请复制 .env.example 为 .env.local 并填入" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `模型接口报错：${text}` }, { status: 502 });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return Response.json({ content });
  } catch (err) {
    return Response.json({ error: `请求模型失败：${String(err)}` }, { status: 502 });
  }
}
