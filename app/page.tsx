"use client";

import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      setMessages([
        ...next,
        { role: "assistant", content: data.content ?? data.error ?? "无响应" },
      ]);
    } catch (err) {
      setMessages([
        ...next,
        { role: "assistant", content: "请求失败：" + String(err) },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>CodePilot</h1>
      <div className="sub">代码仓库问答 Agent · M0 地基</div>

      <div className="chat">
        {messages.length === 0 && (
          <div className="empty">
            先试一句：你好，用一句话介绍你自己。
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {loading && <div className="msg assistant">思考中…</div>}
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
          发送
        </button>
      </div>
    </main>
  );
}
