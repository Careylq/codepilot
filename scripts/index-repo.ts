/**
 * 构建时索引脚本：把多个仓库切块、embedding、写入数据库。
 *
 * 用法：
 *   pnpm index
 *
 * 为什么要离线跑：
 *   - serverless 环境文件系统只读、且不一定有源码
 *   - 首次请求建索引会超时、且重复烧 embedding 费用
 */
import "./env";

import path from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

import { indexRepo } from "../lib/indexer";
import { embed } from "../lib/embedding";
import { prisma } from "../lib/db";

const BATCH_SIZE = 16;

const ZUSTAND_ROOT = path.join(process.cwd(), "repos/zustand");

if (!existsSync(ZUSTAND_ROOT)) {
  console.log("未找到 repos/zustand，自动克隆...");
  execSync(
    "git clone --depth 1 https://github.com/pmndrs/zustand.git repos/zustand",
    { stdio: "inherit" },
  );
}

const REPOS = [
  { name: "codepilot", root: process.cwd() },
  { name: "zustand", root: ZUSTAND_ROOT },
];

async function main() {
  for (const { name, root } of REPOS) {
    console.log(`\n=== ${name} ===`);
    console.log(`根目录：${root}`);

    const chunks = await indexRepo(root);
    console.log(`切分得到 ${chunks.length} 块`);

    await prisma.chunk.deleteMany({ where: { repo: name } });
    console.log("已清空该仓库旧索引");

    let done = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      const vectors = await embed(batch.map((c) => `${c.path}\n${c.content}`));

      for (let j = 0; j < batch.length; j++) {
        await prisma.chunk.create({
          data: {
            repo: name,
            path: batch[j].path,
            startLine: batch[j].startLine,
            endLine: batch[j].endLine,
            content: batch[j].content,
            symbol: batch[j].symbol,
            kind: batch[j].kind,
            embedding: JSON.stringify(vectors[j]),
          },
        });
        done++;
      }

      console.log(`已写入 ${done}/${chunks.length}`);
    }
  }

  await prisma.$disconnect();
  console.log("\n索引完成");
}

main().catch(async (err) => {
  console.error("索引失败：", err);
  await prisma.$disconnect();
  process.exit(1);
});
