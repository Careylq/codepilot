import { describe, expect, it } from "vitest";
import { BM25, tokenize } from "../lib/bm25";

describe("tokenize", () => {
  it("拆分 camelCase，并把中文切成 2-gram", () => {
    const tokens = tokenize("readFileTool 代码仓库");
    expect(tokens).toContain("readfiletool");
    expect(tokens).toContain("read");
    expect(tokens).toContain("file");
    expect(tokens).toContain("tool");
    expect(tokens).toContain("代码");
    expect(tokens).toContain("码仓");
  });
});

describe("BM25", () => {
  it("命中词更多的文档排第一", () => {
    const bm = new BM25();
    bm.add(tokenize("export const readFileTool = { name: 'read_file' }"));
    bm.add(tokenize("const other = 1"));
    bm.finalize();

    const hits = bm
      .score(tokenize("readFileTool"))
      .sort((a, b) => b.score - a.score);

    expect(hits[0].id).toBe(0);
  });
});
