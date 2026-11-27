# CodePilot

> 代码仓库问答 Agent：用自然语言问代码问题，Agent 自己搜索、读文件，给出带「文件:行号」引用的答案。

一个从零手写的 Agent 应用，用来回答“这个函数在哪定义”“agent loop 怎么实现的”这类问题。

> **Live Demo**：https://codepilot-nu.vercel.app
> 访问口令请通过简历 / 邮件获取（防止被脚本刷额度）。

---

## 核心能力

- **手写 agent loop**：不用 LangChain / LangGraph，自己实现「模型 → tool_calls → 执行 → 回填 → 再调用」
- **多仓库**：内置 codepilot / zustand 两个仓库，前端可切换
- **AST 函数级切分**：ts-morph 按函数/类/接口切，非 TS 回退行窗口
- **混合检索**：BM25 关键词 + bge-m3 向量，加权 RRF 融合
- **流式交互**：SSE 逐 token 输出，工具调用过程可视化
- **引用可点**：回答里的 `path:line` 可点击，弹窗高亮对应代码
- **工程韧性**：工具超时、结果预算、上下文预算、会话记忆
- **可评测**：50 条评测集，hit@5 / MRR 三路对照

---

## 架构

```
Browser (Next.js / React)
   │  SSE: step / token / tool_call / tool_result / done
   ▼
/api/chat ──► runAgentStream (loop, max 8 steps)
                ├─ search_code ──► hybrid search
                │                   ├─ BM25 (关键词)
                │                   ├─ bge-m3 (向量, 1024 维)
                │                   └─ 加权 RRF 融合
                └─ read_file   ──► fs-guard (路径/扩展名白名单)
                      │
                      ▼
             Prisma + Postgres
             ├─ Chunk  (path / startLine / endLine / content / embedding)
             └─ Memory (sessionId / summary)
```

---

## 评测结果（50 条：30 符号 + 20 自然语言）

| 方法 | hit@5 | MRR |
|---|---|---|
| 纯 BM25 | 0.700 | 0.586 |
| 纯向量 | 0.860 | 0.777 |
| **混合（加权 RRF）** | 0.880 | **0.704** |

### AST 切分前后

| 方法 | 行窗口（51 块） | AST（147 块） |
|---|---|---|
| 纯 BM25 | 0.820 / 0.578 | 0.700 / 0.586 |
| 纯向量 | 0.840 / 0.624 | 0.860 / 0.777 |
| 混合 | 0.840 / 0.636 | **0.880 / 0.704** |

AST 让向量和混合的 MRR 明显提升（混合 +0.068，向量 +0.153），但 BM25 的 hit@5 下降——函数级 chunk 更小，词频统计变弱。

分类看：

| 类型 | BM25 | 向量 | 混合 |
|---|---|---|---|
| 符号题 | 0.867 / 0.768 | 0.967 / 0.882 | 0.967 / **0.896** |
| 自然语言 | 0.450 / 0.314 | 0.700 / 0.620 | 0.750 / 0.416 |

**结论**：混合的 hit@5 最高（0.880），MRR 比 BM25 高约 20%；但**纯向量的 MRR（0.777）反而更高**——RRF 提升了召回，排序却被 BM25 噪声拉低。下一步做 query router（符号走 BM25，自然语言走向量）。

> 评测过程中修掉过两个真问题：索引过期（新文件没进索引）、评测集泄漏（`eval/questions.json` 自己进了索引）。详见 `docs` 或提交历史。

---

## 快速开始

```bash
pnpm install
cp .env.example .env.local      # 填入模型 / embedding key
npx prisma migrate dev          # 建表
pnpm index                      # 构建时索引（切块 + embedding）
pnpm dev                        # http://localhost:3000
```

---

## 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `OPENAI_API_KEY` | 对话模型 key（DeepSeek/OpenAI 兼容） | ✅ |
| `OPENAI_BASE_URL` | 默认 `https://api.deepseek.com/v1` | |
| `MODEL` | 默认 `deepseek-chat` | |
| `EMBEDDING_API_KEY` | embedding key（硅基流动） | ✅ |
| `EMBEDDING_BASE_URL` | 默认 `https://api.siliconflow.cn/v1` | |
| `EMBEDDING_MODEL` | 默认 `BAAI/bge-m3` | |
| `DATABASE_URL` | Postgres 连接串（生产）；本地可用 SQLite | ✅ |
| `ACCESS_CODE` | 公开 demo 的访问口令；留空则不拦截 | |

---

## 部署（Vercel + Neon）

SQLite 在 serverless 上不可用（文件系统只读、临时），生产必须用 Postgres。

1. 在 [Neon](https://neon.tech) 建项目，复制 `DATABASE_URL`
2. 把 `prisma/schema.prisma` 的 `provider` 改成 `postgresql`
3. 本地执行：

```bash
DATABASE_URL="postgres://..." npx prisma migrate deploy
DATABASE_URL="postgres://..." pnpm index
```

4. Vercel 导入仓库，配置环境变量（模型 key、embedding key、`DATABASE_URL`、`ACCESS_CODE`）
5. 部署

> 索引在本地/CI 跑，线上只读，避免 serverless 超时和重复 embedding 费用。

---

## 项目结构

```
app/
  page.tsx              # 聊天界面：SSE 解析、Markdown、引用弹窗
  login/page.tsx        # 访问口令
  api/chat/route.ts     # SSE 流式接口
  api/file/route.ts     # 引用文件片段（带守卫）
  api/eval/route.ts     # 评测接口（仅开发环境）
  api/test-*/           # 调试接口（仅开发环境）
lib/
  agent-stream.ts       # 流式 agent loop
  tools.ts              # 工具注册 + search_code / read_file
  search.ts             # BM25 / 向量 / 加权 RRF
  bm25.ts               # 分词 + BM25
  vector.ts             # embedding 存取
  embedding.ts          # embedding API + 余弦
  indexer.ts            # 遍历 + 切块（AST / 行窗口）
  ast-chunker.ts        # ts-morph 函数级切分
  resilience.ts         # 超时 / 预算 / 上下文裁剪
  memory.ts             # 会话摘要
  fs-guard.ts           # 文件访问白名单
  rate-limit.ts         # 内存限流
  types.ts              # 公共类型
prisma/schema.prisma    # Chunk + Memory
scripts/index-repo.ts   # 构建时索引
eval/questions.json     # 50 条评测集
```

---

## 几个设计决策

**为什么手写 loop？** 想搞清楚消息结构、tool_call 配对、停止条件；用框架会跳过这些。

**为什么混合检索？** 符号查询 BM25 更准，自然语言向量更准；RRF 按排名融合，不依赖分数量纲。

**为什么排除 `.md` 和测试文件？** 文档和测试注释会抢“查实现”的排名；它们应该单独索引或只读不参与。

**为什么上下文裁剪从 `user` 开始？** 避免留下孤立的 `tool` 消息，破坏 `assistant(tool_calls)` 与 `tool(result)` 的配对。

**为什么 SSE 不用 WebSocket？** 服务端单向推送、一问一答，SSE 足够且简单。

---

## 已知限制

- 仓库是预置的（codepilot / zustand），不支持用户上传；索引离线跑
- 向量在 JS 里算余弦，数据量大要换 pgvector
- 限流是单实例内存版，多实例不精确
- 评测集 50 条，样本偏小
- 中文检索用 2-gram，术语泛化有限

---

## License

MIT
