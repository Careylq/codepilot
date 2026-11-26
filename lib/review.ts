import { searchCode } from "./search";

export type ReviewSeverity = "high" | "medium" | "low";

export type ReviewIssue = {
  severity: ReviewSeverity;
  file: string;
  line?: number;
  title: string;
  detail: string;
  suggestion?: string;
};

export type ReviewPlanFile = {
  path: string;
  focus: string;
  queries: string[];
};

export type ReviewPlan = { files: ReviewPlanFile[] };

export type ReviewSnippet = {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string;
  content: string;
};

export type ReviewResult = {
  summary: string;
  issues: ReviewIssue[];
  plan: ReviewPlan;
  contextCount: number;
};

export type ReviewCallbacks = {
  onStep?: (step: string) => void;
  onPlan?: (plan: ReviewPlan) => void;
  onContext?: (count: number) => void;
};

export type DiffFile = {
  path: string;
  hunks: string[];
  added: string[];
  removed: string[];
};

const MAX_DIFF_CHARS = 16000;
const MAX_CONTEXT_CHARS = 9000;

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of diff.split("\n")) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) {
      current = { path: m[2], hunks: [], added: [], removed: [] };
      files.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("@@")) {
      current.hunks.push(line);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed.push(line.slice(1));
    }
  }

  return files;
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractSymbols(lines: string[]): string[] {
  const out = new Set<string>();

  for (const line of lines) {
    const m = line.match(
      /(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    );
    if (m) out.add(m[1]);
  }

  return [...out].slice(0, 3);
}

async function callModel(
  system: string,
  user: string,
  json = true,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.MODEL ?? "deepseek-chat";

  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  };

  if (json) body.response_format = { type: "json_object" };

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`模型接口报错：${await res.text()}`);

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function plan(diff: string, files: DiffFile[]): Promise<ReviewPlan> {
  const system = `你是代码审查的规划器。给定一段 unified diff，拆出每个改动文件要审查的重点，并为每个文件生成 1-2 个用于检索代码上下文的关键词（优先用函数名、类名、文件名这类标识符）。
只输出 JSON，格式：
{"files":[{"path":"文件路径","focus":"审查重点","queries":["标识符1","标识符2"]}]}
最多 5 个文件。`;

  try {
    const text = await callModel(system, diff.slice(0, MAX_DIFF_CHARS));
    const data = extractJson(text);

    if (Array.isArray(data?.files) && data.files.length > 0) {
      return {
        files: data.files.slice(0, 5).map((f: any) => ({
          path: String(f.path ?? ""),
          focus: String(f.focus ?? "整体改动"),
          queries: Array.isArray(f.queries)
            ? f.queries.slice(0, 2).map(String)
            : [String(f.path ?? "")],
        })),
      };
    }
  } catch {
    // fall through to rule-based plan
  }

  return {
    files: files.slice(0, 5).map((f) => ({
      path: f.path,
      focus: "整体改动",
      queries: [f.path, ...extractSymbols(f.added)].slice(0, 2),
    })),
  };
}

async function retrieve(
  reviewPlan: ReviewPlan,
  repo: string,
): Promise<ReviewSnippet[]> {
  const snippets: ReviewSnippet[] = [];
  const seen = new Set<string>();

  for (const file of reviewPlan.files) {
    for (const query of file.queries.slice(0, 2)) {
      let hits;
      try {
        hits = await searchCode(query, 2, repo);
      } catch {
        continue;
      }

      for (const hit of hits) {
        const key = `${hit.path}:${hit.startLine}`;
        if (seen.has(key)) continue;
        seen.add(key);
        snippets.push({
          path: hit.path,
          startLine: hit.startLine,
          endLine: hit.endLine,
          symbol: hit.symbol ?? "",
          content: hit.snippet,
        });
      }
    }
  }

  return snippets.slice(0, 8);
}

function normalizeIssues(data: any): ReviewIssue[] {
  if (!Array.isArray(data?.issues)) return [];

  return data.issues
    .slice(0, 12)
    .map((i: any) => {
      const severity: ReviewSeverity =
        i.severity === "high" || i.severity === "medium" ? i.severity : "low";

      return {
        severity,
        file: String(i.file ?? ""),
        line: Number.isFinite(Number(i.line)) ? Number(i.line) : undefined,
        title: String(i.title ?? "未命名问题"),
        detail: String(i.detail ?? ""),
        suggestion: i.suggestion ? String(i.suggestion) : undefined,
      };
    })
    .filter((i: ReviewIssue) => Boolean(i.file && i.title));
}

async function review(
  diff: string,
  snippets: ReviewSnippet[],
): Promise<{ summary: string; issues: ReviewIssue[] }> {
  const context = snippets
    .map(
      (s) =>
        `--- ${s.path}:${s.startLine}-${s.endLine}${s.symbol ? ` [${s.symbol}]` : ""}\n${s.content}`,
    )
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  const system = `你是资深代码审查员。根据 diff 和检索到的代码上下文，找出这次改动里真实存在的问题。
要求：
1. 只报有证据的问题，不要泛泛而谈（比如“建议加注释”）。
2. 每个问题给出严重级别：high（bug/安全/数据丢失）、medium（性能/可维护性）、low（风格）。
3. 给出行号时，用 diff 里的新文件行号。
只输出 JSON：
{"summary":"一句话总结","issues":[{"severity":"high","file":"路径","line":123,"title":"问题标题","detail":"为什么是问题","suggestion":"怎么改"}]}
没有问题就返回空数组。`;

  const text = await callModel(
    system,
    `DIFF:\n${diff.slice(0, MAX_DIFF_CHARS)}\n\nCODE CONTEXT:\n${context}`,
  );

  const data = extractJson(text);
  const issues = normalizeIssues(data);

  const summary =
    typeof data?.summary === "string" && data.summary.trim()
      ? data.summary.trim()
      : issues.length === 0
        ? "没有发现明确问题"
        : `发现 ${issues.length} 个问题（high ${issues.filter((i) => i.severity === "high").length} 个）`;

  return { summary, issues };
}

export async function runReview(
  diff: string,
  repo: string,
  cb: ReviewCallbacks = {},
): Promise<ReviewResult> {
  const files = parseDiff(diff);

  if (files.length === 0) {
    throw new Error("没有解析到 diff，请确认是 unified diff 格式");
  }

  cb.onStep?.("Planner");
  const reviewPlan = await plan(diff, files);
  cb.onPlan?.(reviewPlan);

  cb.onStep?.("Retriever");
  const snippets = await retrieve(reviewPlan, repo);
  cb.onContext?.(snippets.length);

  cb.onStep?.("Reviewer");
  const { summary, issues } = await review(diff, snippets);

  cb.onStep?.("Summarizer");

  return { summary, issues, plan: reviewPlan, contextCount: snippets.length };
}
