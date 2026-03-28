import { describe, expect, it, vi } from "vitest";

import {
  createContextStore,
  createConversation,
  type ContextJournal,
  type PiRuntime,
} from "./index.js";

describe("conversation", () => {
  it("appends user and assistant messages into the canonical store", async () => {
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
    const conversation = createConversation({
      store,
      runtime,
      threadId: "thread-1",
      userId: "user-1",
      agentId: "agent-1",
      idGenerator: (() => {
        const ids = ["message-1", "message-2"];
        return () => ids.shift() ?? "message-overflow";
      })(),
    });

    const deltas: string[] = [];
    const assistantMessage = await conversation.sendUserMessage("見て", {
      onTextDelta(delta) {
        deltas.push(delta);
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
    expect(assistantMessage).toMatchObject({
      id: "message-2",
      type: "message",
      createdBy: "agent-1",
      payload: {
        role: "assistant",
        text: "assistant <- thread thread-1\nuser: 見て",
        threadId: "thread-1",
        previousMessageId: "message-1",
      },
    });
    expect(conversation.listThread()).toMatchObject([
      { id: "thread-1", type: "thread" },
      {
        id: "message-1",
        type: "message",
        createdBy: "user-1",
        payload: {
          role: "user",
          text: "見て",
          threadId: "thread-1",
        },
      },
      {
        id: "message-2",
        type: "message",
        createdBy: "agent-1",
      },
    ]);
  });

  it("persists tool-call and tool-result contexts for runtime activity", async () => {
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

        return {
          output: "done",
        };
      }),
    };

    const store = createContextStore();
    const conversation = createConversation({
      store,
      runtime,
      threadId: "thread-tools",
      userId: "user-1",
      agentId: "agent-1",
      idGenerator: (() => {
        const ids = ["message-1", "message-2", "tool-call-1", "tool-result-1"];
        return () => ids.shift() ?? "overflow-id";
      })(),
    });

    await conversation.sendUserMessage("README を見て");

    expect(runtime.run).toHaveBeenCalledWith(
      {
        input: "thread thread-tools\nuser: README を見て",
        systemPrompt: undefined,
      },
      expect.objectContaining({
        onToolCall: expect.any(Function),
        onToolResult: expect.any(Function),
      }),
    );

    expect(conversation.listThread()).toMatchObject([
      { id: "thread-tools", type: "thread" },
      { id: "message-1", type: "message" },
      {
        id: "tool-call-1",
        type: "tool-call",
        createdBy: "agent-1",
        payload: {
          tool: "read",
          args: { path: "README.md" },
          threadId: "thread-tools",
          runtimeToolCallId: "call-1",
          targetId: "message-1",
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
      { id: "message-2", type: "message" },
    ]);
  });

  it("writes appended contexts into the journal", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({
        output: "done",
      }),
    };
    const journal: ContextJournal = {
      append: vi.fn(),
      appendMany: vi.fn(),
    };

    const store = createContextStore();
    const conversation = createConversation({
      store,
      runtime,
      threadId: "thread-journal",
      userId: "user-1",
      agentId: "agent-1",
      journal,
      idGenerator: (() => {
        const ids = ["message-1", "message-2"];
        return () => ids.shift() ?? "message-overflow";
      })(),
    });

    await conversation.sendUserMessage("保存して");

    expect(journal.append).toHaveBeenCalledTimes(3);
    expect(journal.append).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "thread-journal", type: "thread" }),
    );
    expect(journal.append).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "message-1", type: "message" }),
    );
    expect(journal.append).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: "message-2", type: "message" }),
    );
  });
});
