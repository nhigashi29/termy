import { describe, expect, it } from "vitest";

import { createContextNode, createContextStore } from "./index.js";

describe("context-store", () => {
  it("stores and retrieves contexts by id", () => {
    const store = createContextStore();
    const thread = createContextNode({
      id: "thread:1",
      type: "thread",
      payload: {},
    });

    store.append(thread);

    expect(store.get("thread:1")).toEqual(thread);
    expect(store.list()).toEqual([thread]);
  });

  it("lists thread-scoped contexts including tool activity and returns the latest message", () => {
    const store = createContextStore();
    const thread = createContextNode({
      id: "thread:1",
      type: "thread",
      payload: {},
    });
    const firstMessage = createContextNode({
      id: "message:1",
      type: "message",
      payload: {
        role: "user" as const,
        text: "hello",
        threadId: "thread:1",
      },
    });
    const toolCall = createContextNode({
      id: "toolcall:1",
      type: "tool-call",
      payload: {
        tool: "read",
        args: { path: "README.md" },
        threadId: "thread:1",
        targetId: "message:1",
      },
    });
    const toolResult = createContextNode({
      id: "toolresult:1",
      type: "tool-result",
      payload: {
        output: "# hello",
        threadId: "thread:1",
        toolCallId: "toolcall:1",
        isError: false,
      },
    });
    const secondMessage = createContextNode({
      id: "message:2",
      type: "message",
      payload: {
        role: "assistant" as const,
        text: "hi",
        threadId: "thread:1",
        previousMessageId: "message:1",
      },
    });

    store.appendMany([thread, firstMessage, toolCall, toolResult, secondMessage]);

    expect(store.listThread("thread:1")).toEqual([
      thread,
      firstMessage,
      toolCall,
      toolResult,
      secondMessage,
    ]);
    expect(store.latestMessage("thread:1")).toEqual(secondMessage);
  });
});
