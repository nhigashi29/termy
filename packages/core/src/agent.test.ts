import { describe, expect, it, vi } from "vitest";

import { createAgent, type PiRuntime } from "./index.js";

describe("createAgent", () => {
  it("delegates non-empty input to the runtime", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({
        output: "runtime result",
      }),
    };

    const agent = createAgent({
      name: "termy-test",
      runtime,
    });

    await expect(agent.run("hello")).resolves.toBe("runtime result");
    expect(runtime.run).toHaveBeenCalledWith({ input: "hello" });
  });

  it("handles empty input without calling the runtime", async () => {
    const runtime: PiRuntime = {
      run: vi.fn(),
    };

    const agent = createAgent({
      runtime,
    });

    await expect(agent.run("   ")).resolves.toBe("何か入力してね。");
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
