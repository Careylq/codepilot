import { describe, expect, it } from "vitest";
import { fitMessages } from "../lib/resilience";
import type { ChatMessage } from "../lib/types";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

describe("fitMessages", () => {
  it("保留 system，且剩余部分从 user 开始", () => {
    const messages: ChatMessage[] = [msg("system", "you are helpful")];
    for (let i = 0; i < 20; i++) {
      messages.push(msg(i % 2 === 0 ? "user" : "assistant", "x".repeat(2000)));
    }

    const out = fitMessages(messages, 4000);
    expect(out[0].role).toBe("system");

    const rest = out.slice(1);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest[0].role).toBe("user");
  });

  it("未超预算时原样返回", () => {
    const messages = [msg("system", "s"), msg("user", "hi")];
    expect(fitMessages(messages, 10000)).toEqual(messages);
  });
});
