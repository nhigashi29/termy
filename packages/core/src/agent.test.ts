import { describe, expect, it, vi } from "vitest";

import {
  createContextNode,
  createContextStore,
  type ContextJournal,
  type PiRuntime,
} from "./index.js";
import { createAgent } from "./agent.js";
import { conversationProjection } from "./projection.js";

describe("agent", () => {
  it("runs and produces assistant message in AgentRunResult.contexts", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockImplementation(async (request, hooks) => {
        hooks?.onTextDelta?.("hello");
        hooks?.onTextDelta?.(" world");
        return {
          output: `assistant <- ${request.input}`,
        };
      }),
    };

    const store = createContextStore();
    const agent = createAgent({
      id: "agent-1",
      store,
      runtime,
      projection: conversationProjection(),
      idGenerator: (() => {
        const ids = ["message-1"];
        return () => ids.shift() ?? "overflow";
      })(),
    });

    // Create user message manually (as CLI would do)
    const threadId = "thread-1";
    store.append(
      createContextNode({
        id: threadId,
        type: "thread",
        payload: {},
      }),
    );
    store.append(
      createContextNode({
        id: "user-msg-1",
        type: "message",
        createdBy: "user-1",
        payload: {
          role: "user" as const,
          text: "見て",
          threadId,
        },
      }),
    );

    const deltas: string[] = [];
    const result = await agent.run({
      threadId,
      contexts: store.listThread(threadId),
      hooks: {
        onTextDelta(delta) {
          deltas.push(delta);
        },
      },
    });

    expect(deltas).toEqual(["hello", " world"]);
    expect(runtime.run).toHaveBeenCalledWith(
      {
        input: "thread thread-1\nuser: 見て",
        systemPrompt: undefined,
      },
      expect.objectContaining({ onTextDelta: expect.any(Function) }),
    );

    // Result contains the produced assistant message
    const assistantMsg = result.contexts.find(
      (c) => c.type === "message" && c.payload.role === "assistant",
    );
    expect(assistantMsg).toMatchObject({
      id: "message-1",
      type: "message",
      createdBy: "agent-1",
      payload: {
        role: "assistant",
        text: "assistant <- thread thread-1\nuser: 見て",
        threadId: "thread-1",
      },
    });

    // Store contains thread + user message + assistant message
    expect(store.listThread(threadId)).toMatchObject([
      { id: "thread-1", type: "thread" },
      { id: "user-msg-1", type: "message", payload: { role: "user" } },
      { id: "message-1", type: "message", payload: { role: "assistant" } },
    ]);
  });

  it("persists tool-call and tool-result contexts", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockImplementation(async (_request, hooks) => {
        hooks?.onToolCall?.({
          toolCallId: "call-1",
          tool: "read",
          args: { path: "README.md" },
        });
        hooks?.onToolResult?.({
          toolCallId: "call-1",
          tool: "read",
          output: "# hello",
          isError: false,
        });
        return { output: "done" };
      }),
    };

    const store = createContextStore();
    const threadId = "thread-tools";
    store.append(createContextNode({ id: threadId, type: "thread", payload: {} }));
    store.append(
      createContextNode({
        id: "user-msg-1",
        type: "message",
        createdBy: "user-1",
        payload: { role: "user" as const, text: "README を見て", threadId },
      }),
    );

    const agent = createAgent({
      id: "agent-1",
      store,
      runtime,
      projection: conversationProjection(),
      idGenerator: (() => {
        const ids = ["tool-call-1", "tool-result-1", "message-2"];
        return () => ids.shift() ?? "overflow-id";
      })(),
    });

    const result = await agent.run({
      threadId,
      contexts: store.listThread(threadId),
    });

    // Result contains tool-call, tool-result, and assistant message
    expect(result.contexts).toMatchObject([
      {
        id: "tool-call-1",
        type: "tool-call",
        createdBy: "agent-1",
        payload: {
          tool: "read",
          args: { path: "README.md" },
          threadId: "thread-tools",
          runtimeToolCallId: "call-1",
        },
      },
      {
        id: "tool-result-1",
        type: "tool-result",
        createdBy: "agent-1",
        payload: {
          output: "# hello",
          threadId: "thread-tools",
          runtimeToolCallId: "call-1",
          toolCallId: "tool-call-1",
          isError: false,
        },
      },
      {
        id: "message-2",
        type: "message",
        payload: { role: "assistant" },
      },
    ]);

    // Store has all contexts
    expect(store.listThread(threadId)).toMatchObject([
      { id: "thread-tools", type: "thread" },
      { id: "user-msg-1", type: "message" },
      { id: "tool-call-1", type: "tool-call" },
      { id: "tool-result-1", type: "tool-result" },
      { id: "message-2", type: "message" },
    ]);
  });

  it("writes produced contexts to the journal via store", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "done" }),
    };
    const journal: ContextJournal = {
      append: vi.fn(),
      appendMany: vi.fn(),
    };

    const store = createContextStore([], { journal });
    const agent = createAgent({
      id: "agent-1",
      store,
      runtime,
      projection: conversationProjection(),
      idGenerator: (() => {
        const ids = ["message-2"];
        return () => ids.shift() ?? "overflow";
      })(),
    });

    const threadId = "thread-journal";
    store.append(createContextNode({ id: threadId, type: "thread", payload: {} }));
    store.append(
      createContextNode({
        id: "message-1",
        type: "message",
        createdBy: "user-1",
        payload: { role: "user" as const, text: "保存して", threadId },
      }),
    );

    // journal.append called for thread + user message so far = 2 calls
    expect(journal.append).toHaveBeenCalledTimes(2);

    await agent.run({
      threadId,
      contexts: store.listThread(threadId),
    });

    // +1 for assistant message
    expect(journal.append).toHaveBeenCalledTimes(3);
    expect(journal.append).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: "message-2", type: "message" }),
    );
  });

  it("creates thread automatically if not in store", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "hi" }),
    };

    const store = createContextStore();
    const agent = createAgent({
      id: "agent-1",
      store,
      runtime,
      projection: conversationProjection(),
    });

    const result = await agent.run({
      threadId: "new-thread",
      contexts: [],
    });

    const threadCtx = result.contexts.find((c) => c.type === "thread");
    expect(threadCtx).toMatchObject({ id: "new-thread", type: "thread" });
    expect(store.get("new-thread")).toBeDefined();
  });
});
