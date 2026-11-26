"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Issue = {
  severity: "high" | "medium" | "low";
  file: string;
  line?: number;
  title: string;
  detail: string;
  suggestion?: string;
};

type ReviewResult = {
  summary: string;
  issues: Issue[];
  plan: { files: { path: string; focus: string; queries: string[] }[] };
  contextCount: number;
};

const SAMPLE_DIFF = `diff --git a/lib/file-content.ts b/lib/file-content.ts
--- a/lib/file-content.ts
+++ b/lib/file-content.ts
@@ -13,6 +13,7 @@ export async function getFileContent(
   const guard = isSafeRepoPath(rel);
   if (!guard.ok) return { ok: false, error: guard.error };
 
+  const rows = await prisma.chunk.findMany({ where: { path: rel } });
   const chunks = await prisma.chunk.findMany({
     where: { repo, path: rel },
   });
`;

export default function ReviewPage() {
  const [repo, setRepo] = useState("codepilot");
  const [repos, setRepos] = useState<{ repo: string; chunks: number }[]>([
    { repo: "codepilot", chunks: 0 },
    { repo: "zustand", chunks: 0 },
  ]);
  const [diff, setDiff] = useState(SAMPLE_DIFF);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setRepos(data);
      })
      .catch(() => {});
  }, []);

  async function run() {
    if (!diff.trim() || loading) return;

    setLoading(true);
    setSteps([]);
    setResult(null);
    setError("");

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff, repo }),
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

          if (event === "step") {
            setSteps((prev) => [...prev, data.step]);
          } else if (event === "plan") {
            setSteps((prev) => [
              ...prev,
              `计划：${data.files?.length ?? 0} 个文件`,
            ]);
          } else if (event === "context") {
            setSteps((prev) => [...prev, `检索到 ${data.count} 段上下文`]);
          } else if (event === "done") {
            setResult(data as ReviewResult);
          } else if (event === "error") {
            setError(data.message);
          }
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="review-top">
        <Link href="/" className="back">
          ← 返回问答
        </Link>
      </div>

      <h1>Code Review</h1>
      <div className="sub">
        贴一段 unified diff · Planner → Retriever → Reviewer → Summarizer
      </div>

      <div className="review-controls">
        <select
          className="repo-select"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          {repos.map((r) => (
            <option key={r.repo} value={r.repo}>
              {r.repo}（{r.chunks} 块）
            </option>
          ))}
        </select>

        <button onClick={run} disabled={loading || !diff.trim()}>
          {loading ? "审查中…" : "开始审查"}
        </button>
      </div>

      <textarea
        className="review-textarea"
        value={diff}
        onChange={(e) => setDiff(e.target.value)}
        spellCheck={false}
        placeholder="diff --git a/... b/..."
      />

      {steps.length > 0 && (
        <div className="review-steps">
          {steps.map((s, i) => (
            <span key={i} className="review-step">
              {s}
            </span>
          ))}
        </div>
      )}

      {error && <div className="review-error">错误：{error}</div>}

      {result && (
        <div className="review-result">
          <div className="review-summary">
            {result.summary}
            <span className="muted">
              {" "}
              · 上下文 {result.contextCount} 段
            </span>
          </div>

          {result.issues.length === 0 && (
            <div className="muted">没有发现明确问题。</div>
          )}

          {result.issues.map((issue, i) => (
            <div key={i} className={`issue ${issue.severity}`}>
              <div className="issue-head">
                <span className="badge">{issue.severity}</span>
                <span>{issue.title}</span>
              </div>
              <div className="issue-loc">
                {issue.file}
                {issue.line ? `:${issue.line}` : ""}
              </div>
              <p>{issue.detail}</p>
              {issue.suggestion && (
                <p className="suggestion">建议：{issue.suggestion}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
