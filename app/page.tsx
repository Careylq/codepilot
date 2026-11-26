"use client";

import { useState, type ReactNode } from "react";

type TraceEvent =
  | { type: "step"; step: number }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; ok: boolean; preview: string };

type Msg = {
  role: "user" | "assistant";
  content: string;
  events?: TraceEvent[];
  done?: boolean;
};

type Viewer = {
  path: string;
  line: number;
  lines: { n: number; t: string }[];
};

const CITE_PATTERN = "`([\\w./-]+\\.(?:ts|tsx|js|jsx|json|css)):(\\d+)(?:-(\\d+))?`";

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);

  function patchLast(fn: (m: Msg) => Msg) {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const i = copy.length - 1;
      copy[i] = fn(copy[i]);
      return copy;
    });
  }

  async function openCite(p: string, line: number) {
    try {
      const res = await fetch(
        `/api/file?path=${encodeURIComponent(p)}&line=${line}`,
      );
      const data = await res.json();
      if (!data.error) setViewer(data as Viewer);
    } catch {
      // ignore
    }
  }

  function renderContent(text: string): ReactNode[] {
    const re = new RegExp(CITE_PATTERN, "g");
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;

    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const [full, p, line] = m;
      out.push(
        <button
          key={`c${key++}`}
          className="cite"
          onClick={() => openCite(p, Number(line))}
        >
          {p}:{line}
        </button>,
      );
      last = m.index + full.length;
    }

    out.push(text.slice(last));
    return out;
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", events: [], done: false },
    ]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: text }],
        }),
      });

      if (!res.body) throw new Error("没有响应流");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const lines = frame.split("\n");
          const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
          const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
          if (!event || !dataLine) continue;

          const data = JSON.parse(dataLine);

          if (event === "token") {
            patchLast((m) => ({ ...m, content: m.content + data.text }));
          } else if (event === "step") {
            patchLast((m) => ({
              ...m,
              events: [...(m.events ?? []), { type: "step", step: data.step }],
            }));
          } else if (event === "tool_call") {
            patchLast((m) => ({
              ...m,
              events: [
                ...(m.events ?? []),
                { type: "tool_call", name: data.name, args: data.args },
              ],
            }));
          } else if (event === "tool_result") {
            patchLast((m) => ({
              ...m,
              events: [
                ...(m.events ?? []),
                {
                  type: "tool_result",
                  name: data.name,
                  ok: data.ok,
                  preview: data.preview,
                },
              ],
            }));
          } else if (event === "error") {
            patchLast((m) => ({
              ...m,
              content: m.content + `\n\n错误：${data.message}`,
            }));
          }
        }
      }
    } catch (err) {
      patchLast((m) => ({
        ...m,
        content: m.content + `\n\n请求失败：${String(err)}`,
      }));
    } finally {
      patchLast((m) => ({ ...m, done: true }));
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>CodePilot</h1>
      <div className="sub">代码仓库问答 Agent · M4 流式 + 工具可视化 + 引用可点</div>

      <div className="chat">
        {messages.length === 0 && (
          <div className="empty">
            试试问：readFileTool 这个工具在哪定义的？
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" ? renderContent(m.content) : m.content}
            {!m.done && m.role === "assistant" && (
              <span className="cursor">▍</span>
            )}

            {m.events && m.events.length > 0 && (
              <details className="trace" open={!m.done}>
                <summary>
                  执行过程（
                  {m.events.filter((e) => e.type === "tool_call").length} 次工具调用）
                </summary>
                <ul>
                  {m.events.map((e, j) => {
                    if (e.type === "step") {
                      return (
                        <li key={j} className="step">
                          第 {e.step} 步
                        </li>
                      );
                    }
                    if (e.type === "tool_call") {
                      return (
                        <li key={j} className="call">
                          🔧 <code>{e.name}</code>{" "}
                          <code className="args">{e.args}</code>
                        </li>
                      );
                    }
                    return (
                      <li key={j} className={e.ok ? "ok" : "err"}>
                        {e.ok ? "✅" : "❌"} {e.name}：
                        {e.preview.slice(0, 80)}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder="问点什么…"
        />
        <button onClick={send} disabled={loading || !input.trim()}>
          {loading ? "回答中…" : "发送"}
        </button>
      </div>

      {viewer && (
        <div className="viewer" onClick={() => setViewer(null)}>
          <div className="viewer-box" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-head">
              <span>
                {viewer.path}:{viewer.line}
              </span>
              <button onClick={() => setViewer(null)}>关闭</button>
            </div>
            <pre>
              {viewer.lines.map((l) => (
                <div
                  key={l.n}
                  className={`row ${l.n === viewer.line ? "hit" : ""}`}
                >
                  <span className="ln">{l.n}</span>
                  <code>{l.t}</code>
                </div>
              ))}
            </pre>
          </div>
        </div>
      )}
    </main>
  );
}
