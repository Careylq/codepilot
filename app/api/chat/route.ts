import { NextRequest } from "next/server";
import { runAgent, type ChatMessage } from "@/lib/agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as { messages: ChatMessage[] };

  try {
    const result = await runAgent(messages);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
