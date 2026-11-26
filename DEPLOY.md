# 部署清单（Vercel + Neon Postgres）

> 目标：公开 demo 可访问、不泄密、不被刷额度。
> 预算：Neon 免费档 + Vercel Hobby + 模型/embedding 按量，月成本可控制在 50 元内。

---

## 0. 前置

- [Neon](https://neon.tech) 账号
- [Vercel](https://vercel.com) 账号
- GitHub 仓库

---

## 1. 建 Neon 数据库

1. Neon → New Project
2. Region 选 **Singapore**（离国内近）
3. 复制连接串，形如：

```
postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

---

## 2. 把 Prisma 切到 Postgres

### 2.1 改 provider

`prisma/schema.prisma`：

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 2.2 加环境变量

`.env.local` 追加：

```bash
DATABASE_URL=postgresql://...
```

### 2.3 重建 migration

现有 migration 是 SQLite 生成的，不能直接用于 Postgres。**首次切换**：

```bash
rm -rf prisma/migrations
npx prisma migrate dev --name init_postgres
```

### 2.4 写入索引

```bash
pnpm index
```

> 索引在本地跑，**不要**放到 Vercel 构建里：会重复 embedding、且容易超时。

---

## 3. 部署到 Vercel

1. 推到 GitHub
2. Vercel → Import Project
3. 环境变量：

| 变量 | 值 |
|---|---|
| `OPENAI_API_KEY` | 你的对话模型 key |
| `OPENAI_BASE_URL` | `https://api.deepseek.com/v1` |
| `MODEL` | `deepseek-chat` |
| `EMBEDDING_API_KEY` | 硅基流动 key |
| `EMBEDDING_BASE_URL` | `https://api.siliconflow.cn/v1` |
| `EMBEDDING_MODEL` | `BAAI/bge-m3` |
| `DATABASE_URL` | Neon 连接串 |
| `ACCESS_CODE` | 自定义访问口令 |

4. Build Command 保持默认（`prisma generate && next build`）
5. Deploy

---

## 4. 上线后验证（5 条）

- [ ] 打开 `/` 被重定向到 `/login`
- [ ] 输入 `ACCESS_CODE` 能进入
- [ ] 问“readFileTool 在哪定义”，能流式回答并给引用
- [ ] `GET /api/file?path=.env.local` → 返回“拒绝：不允许访问隐藏文件”
- [ ] 1 分钟内连发 21 次 `/api/chat` → 第 21 次返回 429

---

## 5. 本地开发怎么办

切到 Postgres 后，本地也连 Neon（免费档够用）。如果不想联网：

- 保留一份 `prisma/schema.sqlite.prisma`
- 用 `DATABASE_URL=file:./dev.db` 和 `prisma migrate dev --schema prisma/schema.sqlite.prisma`
- 但**两套 schema 容易漂移**，不建议长期维护

---

## 6. 注意

- `ACCESS_CODE` 只放环境变量，**不要提交**
- Vercel Hobby 的函数上限是 60s，`/api/chat` 已设 `maxDuration = 60`
- 限流是单实例内存版，多实例不精确；要精确就换 Upstash Redis
- 公开前确认 `.env.local`、`prisma/*.db` 都在 `.gitignore` 里
