/**
 * 构建时索引脚本：把仓库切块、embedding、写入数据库。
 *
 * 用法：
 *   pnpm index
 *
 * 为什么要离线跑：
 *   - serverless 环境文件系统只读、且不一定有源码
 *   - 首次请求建索引会超时、且重复烧 embedding 费用
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { indexRepo } from "../lib/indexer";
import { embed } from "../lib/embedding";
import { prisma } from "../lib/db";

const BATCH_SIZE = 16;

async function main() {
  console.log("开始索引仓库...");

  const chunks = await indexRepo(process.cwd());
  console.log(`切分得到 ${chunks.length} 块`);

  await prisma.chunk.deleteMany();
  console.log("已清空旧索引");

  let done = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const vectors = await embed(
      batch.map((c) => `${c.path}\n${c.content}`),
    );

    for (let j = 0; j < batch.length; j++) {
      await prisma.chunk.create({
        data: {
          path: batch[j].path,
          startLine: batch[j].startLine,
          endLine: batch[j].endLine,
          content: batch[j].content,
          embedding: JSON.stringify(vectors[j]),
        },
      });
      done++;
    }

    console.log(`已写入 ${done}/${chunks.length}`);
  }

  await prisma.$disconnect();
  console.log("索引完成");
}

main().catch(async (err) => {
  console.error("索引失败：", err);
  await prisma.$disconnect();
  process.exit(1);
});
