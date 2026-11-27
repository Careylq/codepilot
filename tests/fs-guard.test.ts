import { describe, expect, it } from "vitest";
import { isSafeRepoPath } from "../lib/fs-guard";

describe("isSafeRepoPath", () => {
  it("拒绝隐藏文件、数据库、评测目录和越界路径", () => {
    for (const p of [
      ".env.local",
      ".git/config",
      "prisma/dev.db",
      "eval/questions.json",
      "../etc/passwd",
    ]) {
      expect(isSafeRepoPath(p).ok, p).toBe(false);
    }
  });

  it("允许仓库内的代码和文档", () => {
    for (const p of [
      "lib/tools.ts",
      "docs/architecture.md",
      "package.json",
      "prisma/schema.prisma",
    ]) {
      expect(isSafeRepoPath(p).ok, p).toBe(true);
    }
  });
});
