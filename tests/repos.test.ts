import { describe, expect, it } from "vitest";
import { isRepo, normalizeRepo } from "../lib/repos";

describe("repos", () => {
  it("只接受白名单仓库", () => {
    expect(isRepo("codepilot")).toBe(true);
    expect(isRepo("zustand")).toBe(true);
    expect(isRepo("bad")).toBe(false);
  });

  it("非法值回退到 codepilot", () => {
    expect(normalizeRepo("bad")).toBe("codepilot");
    expect(normalizeRepo(undefined)).toBe("codepilot");
  });
});
