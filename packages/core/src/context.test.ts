import { describe, expect, it } from "vitest";

import { createContextNode } from "./index.js";

describe("context", () => {
  it("creates a node with structural fields", () => {
    const user = createContextNode({
      id: "user:naoki",
      type: "user",
      payload: { name: "naoki" },
    });

    expect(user.id).toBe("user:naoki");
    expect(user.type).toBe("user");
    expect(user.payload).toEqual({ name: "naoki" });
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.createdBy).toBeUndefined();
  });

  it("stores creator and thread lineage as explicit relations", () => {
    const message = createContextNode({
      id: "message:1",
      type: "message",
      createdBy: "user:naoki",
      payload: {
        role: "user",
        text: "見て",
        threadId: "thread:1",
        previousMessageId: "message:0",
      },
    });

    expect(message.createdBy).toBe("user:naoki");
    expect(message.payload.threadId).toBe("thread:1");
    expect(message.payload.previousMessageId).toBe("message:0");
  });

  it("stores domain-specific references in payload", () => {
    const toolCall = createContextNode({
      id: "toolcall:1",
      type: "tool-call",
      createdBy: "agent:worker",
      payload: {
        tool: "read",
        args: { path: "src/index.ts" },
        toolDefinitionId: "tooldef:read",
        targetId: "message:1",
      },
    });

    const toolResult = createContextNode({
      id: "toolresult:1",
      type: "tool-result",
      createdBy: "agent:worker",
      payload: {
        output: "ok",
        toolCallId: toolCall.id,
      },
    });

    expect(toolCall.payload.toolDefinitionId).toBe("tooldef:read");
    expect(toolCall.payload.targetId).toBe("message:1");
    expect(toolResult.payload.toolCallId).toBe(toolCall.id);
  });
});
