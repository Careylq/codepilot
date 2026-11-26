"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit() {
    const value = code.trim();
    if (!value || loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });

      if (!res.ok) {
        setError("口令错误");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("请求失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>CodePilot</h1>
      <div className="sub">代码仓库问答 Agent · 请输入访问口令</div>

      <div className="composer" style={{ marginTop: 24 }}>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          placeholder="访问口令"
        />
        <button onClick={submit} disabled={loading || !code.trim()}>
          {loading ? "验证中…" : "进入"}
        </button>
      </div>

      {error && (
        <div style={{ color: "#dc2626", fontSize: 13, marginTop: 10 }}>{error}</div>
      )}
    </main>
  );
}
