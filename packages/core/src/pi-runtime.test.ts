import { describe, expect, it, vi } from "vitest";

import {
  createContextNode,
  runContextsWithPi,
  toPiInput,
  type PiRuntime,
} from "./index.js";

describe("pi-runtime", () => {
  it("projects contexts into pi input text", () => {
    const contexts = [
      createContextNode({
        id: "thread:1",
        type: "thread",
        payload: {},
      }),
      createContextNode({
        id: "message:1",
        type: "message",
        payload: {
          role: "user" as const,
          text: "src/index.ts を見て",
          threadId: "thread:1",
        },
      }),
    ];

    expect(toPiInput(contexts, { threadId: "thread:1" })).toEqual({
      input: "thread thread:1\nuser: src/index.ts を見て",
      systemPrompt: undefined,
    });
  });

  it("runs pi and converts the result into an assistant message", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({
        output: "見てみます",
      }),
    };

    const contexts = [
      createContextNode({
        id: "message:1",
        type: "message",
        payload: {
          role: "user" as const,
          text: "見て",
          threadId: "thread:1",
        },
      }),
    ];

    const message = await runContextsWithPi({
      runtime,
      contexts,
      messageId: "message:2",
      threadId: "thread:1",
      previousMessageId: "message:1",
      createdBy: "agent:pi",
    });

    expect(runtime.run).toHaveBeenCalledWith(
      {
        input: "user: 見て",
        systemPrompt: undefined,
      },
      undefined,
    );
    expect(message).toMatchObject({
      id: "message:2",
      type: "message",
      createdBy: "agent:pi",
      payload: {
        role: "assistant",
        text: "見てみます",
        threadId: "thread:1",
        previousMessageId: "message:1",
      },
    });
  });
});
