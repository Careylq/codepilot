import { describe, expect, it } from "vitest";
import { parseDiff } from "../lib/diff";

describe("parseDiff", () => {
  it("提取文件路径、新增行和删除行", () => {
    const diff = `diff --git a/lib/tools.ts b/lib/tools.ts
--- a/lib/tools.ts
+++ b/lib/tools.ts
@@ -1,2 +1,3 @@
+const x = 1;
-old line
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("lib/tools.ts");
    expect(files[0].added).toEqual(["const x = 1;"]);
    expect(files[0].removed).toEqual(["old line"]);
  });
});
