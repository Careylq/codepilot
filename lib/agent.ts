import { findTool, toModelTools } from "./tools";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

const MAX_STEPS = 8;

const SYSTEM_PROMPT = `你是一个代码仓库助手 CodePilot。
你可以调用两个工具：
- search_code：按关键词搜索代码，返回文件路径、行号和片段
- read_file：读取指定文件的完整内容

工作方式：
1. 不知道代码在哪时，先用 search_code 搜索。
2. 找到文件后，需要看完整实现时再用 read_file。
3. 不要猜代码内容，必须基于工具返回的结果回答。
4. 回答时说明依据来自哪个文件、哪一行。
5. 如果工具报错，如实告诉用户，不要编造。`;

export async function runAgent(input: ChatMessage[]) {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...input,
  ];
  const trace: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await callModel(messages);
    messages.push(msg);

    // 没有工具调用 = 模型认为可以回答了，结束循环
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      trace.push(`step ${step + 1}: 直接回答`);
      return { content: msg.content ?? "", trace };
    }

    trace.push(
      `step ${step + 1}: 调用 ${msg.tool_calls
        .map((c) => `${c.function.name}(${c.function.arguments})`)
        .join(", ")}`,
    );

    // 有工具调用 = 逐个执行，把结果塞回对话
    for (const call of msg.tool_calls) {
      const tool = findTool(call.function.name);
      let output: string;

      if (!tool) {
        output = `错误：未知工具 ${call.function.name}`;
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          output = "错误：参数不是合法 JSON";
          messages.push({ role: "tool", tool_call_id: call.id, content: output });
          continue;
        }

        const result = await tool.execute(args);
        output = result.ok ? result.content : `错误：${result.error}`;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }

  return { content: "达到最大步数，未能完成。", trace };
}

async function callModel(messages: ChatMessage[]): Promise<ChatMessage> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.MODEL ?? "deepseek-chat";

  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: toModelTools(),
      tool_choice: "auto",
    }),
  });

  if (!res.ok) throw new Error(`模型接口报错：${await res.text()}`);

  const data = await res.json();
  return data.choices[0].message as ChatMessage;
}
