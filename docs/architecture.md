# CodePilot 架构

## 一句话

CodePilot 是一个代码仓库问答 Agent：用户用自然语言提问，Agent 自己搜索、读文件，返回带「文件:行号」引用的答案；另有一个 Review 模式，贴 diff 做结构化代码审查。

## 三层结构

| 层 | 文件 | 职责 |
|---|---|---|
| 交互层 | `app/page.tsx`、`app/review/page.tsx` | 聊天 / 审查界面、SSE 解析、引用弹窗 |
| Agent 层 | `lib/agent-stream.ts`、`lib/tools.ts` | 手写 loop、工具注册、工具执行、流式输出 |
| 检索层 | `lib/search.ts`、`lib/bm25.ts`、`lib/vector.ts`、`lib/embedding.ts` | BM25 + 向量 + 加权 RRF |

## 模块职责

### Agent 运行时

- `lib/agent-stream.ts`：手写 agent loop。累积 messages，处理 `tool_calls`，执行工具，把结果以 `tool(tool_call_id)` 回填，最多 8 步；负责 SSE 事件和 60 秒模型超时。
- `lib/tools.ts`：工具定义（`read_file` / `search_code`）、JSON Schema、`ToolContext`（当前 repo）。
- `lib/types.ts`：`ChatMessage`、`ToolCall` 类型。

### 检索

- `lib/indexer.ts`：遍历仓库、调用 AST 切分或行窗口、产出 chunk。
- `lib/ast-chunker.ts`：用 ts-morph 按函数/类/接口切分；非 TS 回退行窗口；Markdown 按 `##` 标题切。
- `lib/bm25.ts`：分词（camelCase 拆分 + 中文 2-gram）和 BM25 打分。
- `lib/embedding.ts`：调 bge-m3 生成 1024 维向量。
- `lib/vector.ts`：向量检索、按 repo 缓存、余弦相似度。
- `lib/search.ts`：`bm25Search` / `vectorSearch` / `hybridSearch` / `searchCode` 路由；加权 RRF、symbol/kind/path/definition 加权、意图词扩展。
- `lib/file-content.ts`：从数据库 chunk 按行号重建文件（线上不读磁盘）。

### 工程

- `lib/db.ts`：PrismaClient 单例。
- `prisma/schema.prisma`：`Chunk`（repo/path/startLine/endLine/content/embedding/symbol/kind）和 `Memory`。
- `lib/resilience.ts`：`withTimeout`、`estimateTokens`、`fitMessages`（上下文预算）。
- `lib/memory.ts`：会话摘要读写。
- `lib/fs-guard.ts`：路径守卫（隐藏文件、`.env`、`.db`、`eval/`、越界）。
- `lib/auth-token.ts`：SHA-256 访问口令 cookie。
- `lib/rate-limit.ts`：按 IP 的内存限流。
- `lib/repos.ts`：仓库白名单（codepilot / zustand）。
- `lib/review.ts`：Review 模式的四角色 DAG。

### API

- `app/api/chat/route.ts`：SSE 聊天入口。
- `app/api/file/route.ts`：引用代码片段。
- `app/api/review/route.ts`：Review SSE 入口。
- `app/api/repos/route.ts`：仓库列表和块数。
- `app/api/login/route.ts`：访问口令校验。

## 常见问题

### 这个项目用了什么数据库？

Neon Postgres（serverless PostgreSQL），通过 Prisma 访问。连接单例在 `lib/db.ts`，schema 在 `prisma/schema.prisma`。早期用 SQLite，上线时因为 serverless 文件系统只读换成了 Postgres。

### 引用点击后怎么加载代码？

前端 `app/page.tsx` 把回答里的 `path:line` 渲染成可点击链接；点击后请求 `app/api/file/route.ts`，它调用 `lib/file-content.ts` 从数据库 chunk 重建文件，返回前后若干行；前端用弹窗高亮显示。

### 多仓库是怎么隔离的？

`Chunk` 表有 `repo` 字段；`lib/repos.ts` 定义白名单；`lib/search.ts` 的 BM25 按 repo 建独立索引，向量检索按 repo 过滤；`lib/tools.ts` 通过 `ToolContext` 把当前 repo 传给工具；前端下拉框切换后请求带 `repo`。

### Review 模式有哪几个角色？

`lib/review.ts` 里是四个角色：Planner（拆文件/检索词）、Retriever（复用 search_code 找上下文）、Reviewer（输出结构化问题）、Summarizer（汇总）。它们是 DAG 工作流，不是自治 Agent。

### 有测试吗？

目前没有自动化测试，只有 `eval/` 下的评测脚本和手动测试路由；`package.json` 里没有 test 脚本。下一步会补 fs-guard、fitMessages、BM25、repo 隔离、RRF 五个单测。

### 怎么评测检索？

`eval/questions.json` 有 50 条问题（30 符号 + 20 自然语言），`app/api/eval/route.ts` 跑 BM25 / 向量 / 混合三路，指标是 hit@5 和 MRR。最新结果：混合 hit@5 0.880，MRR 0.704；纯向量 MRR 0.777 更高。
