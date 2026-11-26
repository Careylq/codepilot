import { findTool, toModelTools } from "./tools";
import type { ChatMessage, ToolCall } from "./types";
import { splitMessages, truncateText, withTimeout } from "./resilience";
import { getMemory, saveMemory, summarize } from "./memory";

export type StreamCallbacks = {
  onStep?: (step: number) => void;
  onToken?: (text: string) => void;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, ok: boolean, preview: string) => void;
};

const MAX_STEPS = 8;
const TOOL_TIMEOUT_MS = 8000;
const TOOL_RESULT_MAX = 6000;
const MAX_CONTEXT_TOKENS = 12000;

const SYSTEM_PROMPT = `你是一个代码仓库助手 CodePilot。
你可以调用两个工具：
- search_code：按关键词搜索代码，返回文件路径、行号和片段
- read_file：读取指定文件的完整内容

工作方式：
1. 不知道代码在哪时，先用 search_code 搜索。
2. 找到文件后，需要看完整实现时再用 read_file。
3. 不要猜代码内容，必须基于工具返回的结果回答。
4. 回答时用 \`文件路径:行号\` 的格式标注依据。
5. 如果工具报错，如实告诉用户，不要编造。`;

export async function runAgentStream(
  input: ChatMessage[],
  cb: StreamCallbacks,
  sessionId?: string,
): Promise<{ content: string; trace: string[] }> {
  const memory = sessionId ? await getMemory(sessionId) : null;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(memory
      ? [{ role: "system" as const, content: `【历史摘要】${memory}` }]
      : []),
    ...input,
  ];
  const trace: string[] = [];
  let summarized = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    cb.onStep?.(step + 1);

    const { fitted, dropped } = splitMessages(messages, MAX_CONTEXT_TOKENS);

    if (!summarized && sessionId && dropped.length >= 4) {
      summarized = true;
      const s = await summarize(dropped);
      if (s) await saveMemory(sessionId, s);
    }

    const { content, toolCalls } = await callModelStream(fitted, cb.onToken);

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    messages.push(assistantMsg);

    if (toolCalls.length === 0) {
      trace.push(`step ${step + 1}: 直接回答`);
      return { content, trace };
    }

    for (const call of toolCalls) {
      cb.onToolCall?.(call.function.name, call.function.arguments);

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
          cb.onToolResult?.(call.function.name, false, output);
          continue;
        }

        try {
          const result = await withTimeout(
            tool.execute(args),
            TOOL_TIMEOUT_MS,
            tool.name,
          );
          output = result.ok
            ? truncateText(result.content, TOOL_RESULT_MAX)
            : `错误：${result.error}`;
        } catch (err) {
          output = `错误：${err instanceof Error ? err.message : String(err)}`;
        }
      }

      cb.onToolResult?.(call.function.name, !output.startsWith("错误"), output.slice(0, 200));
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
      trace.push(`step ${step + 1}: 调用 ${call.function.name}(${call.function.arguments})`);
    }
  }

  return { content: "达到最大步数，未能完成。", trace };
}

async function callModelStream(
  messages: ChatMessage[],
  onToken?: (text: string) => void,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
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
      stream: true,
    }),
  });

  if (!res.ok) throw new Error(`模型接口报错：${await res.text()}`);
  if (!res.body) throw new Error("模型接口没有返回流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let content = "";
  const toolCalls: ToolCall[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        onToken?.(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id ?? "",
              type: "function",
              function: { name: "", arguments: "" },
            };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) {
            toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
    }
  }

  return { content, toolCalls: toolCalls.filter(Boolean) };
}
