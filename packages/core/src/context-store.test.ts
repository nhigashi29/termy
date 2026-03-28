import { describe, expect, it, vi } from "vitest";

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

  it("lists pending tasks for an agent and resolves task status", () => {
    const store = createContextStore();

    const task1 = createContextNode({
      id: "task:1",
      type: "task",
      payload: {
        parentThreadId: "thread:1",
        assignedTo: "agent:worker",
        instruction: "do something",
      },
    });
    const task2 = createContextNode({
      id: "task:2",
      type: "task",
      payload: {
        parentThreadId: "thread:1",
        assignedTo: "agent:worker",
        instruction: "do another thing",
      },
    });
    const task2Done = createContextNode({
      id: "status:1",
      type: "task-status",
      payload: { taskId: "task:2", status: "done" as const },
    });
    const taskResult = createContextNode({
      id: "result:1",
      type: "task-result",
      payload: { taskId: "task:2", threadId: "thread:worker", output: "result" },
    });

    store.appendMany([task1, task2, task2Done, taskResult]);

    expect(store.listPendingTasks("agent:worker")).toEqual([task1]);
    expect(store.latestTaskStatus("task:2")).toEqual(task2Done);
    expect(store.latestTaskStatus("task:1")).toBeUndefined();
    expect(store.listTaskResults("task:2")).toEqual([taskResult]);
    expect(store.listTaskResults("task:1")).toEqual([]);
  });

  it("subscribe notifies on append", () => {
    const store = createContextStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const thread = createContextNode({ id: "t:1", type: "thread", payload: {} });
    store.append(thread);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(thread);
  });

  it("subscribe notifies per context on appendMany", () => {
    const store = createContextStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const t1 = createContextNode({ id: "t:1", type: "thread", payload: {} });
    const t2 = createContextNode({ id: "t:2", type: "thread", payload: {} });
    store.appendMany([t1, t2]);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, t1);
    expect(listener).toHaveBeenNthCalledWith(2, t2);
  });

  it("unsubscribe stops notifications", () => {
    const store = createContextStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.append(createContextNode({ id: "t:1", type: "thread", payload: {} }));
    expect(listener).toHaveBeenCalledOnce();

    unsub();
    store.append(createContextNode({ id: "t:2", type: "thread", payload: {} }));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("latestAgentStatus returns the most recent status for an agent", () => {
    const store = createContextStore();

    store.append(
      createContextNode({
        id: "as:1",
        type: "agent-status",
        payload: { agentId: "agent:w", status: "running" as const, taskId: "task:1" },
      }),
    );
    store.append(
      createContextNode({
        id: "as:2",
        type: "agent-status",
        payload: { agentId: "agent:w", status: "idle" as const },
      }),
    );

    const latest = store.latestAgentStatus("agent:w");
    expect(latest?.payload.status).toBe("idle");
    expect(store.latestAgentStatus("agent:other")).toBeUndefined();
  });

  it("listAgents returns all agent contexts", () => {
    const store = createContextStore();

    const agent1 = createContextNode({
      id: "agent:1",
      type: "agent",
      payload: { name: "reader", role: "worker" },
    });
    const agent2 = createContextNode({
      id: "agent:2",
      type: "agent",
      payload: { name: "manager", role: "manager" },
    });
    const thread = createContextNode({
      id: "thread:1",
      type: "thread",
      payload: {},
    });

    store.appendMany([agent1, agent2, thread]);

    const agents = store.listAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0].payload.name).toBe("reader");
    expect(agents[1].payload.name).toBe("manager");
  });

  it("findAgentByRole returns the first agent with matching role", () => {
    const store = createContextStore();

    store.append(
      createContextNode({
        id: "agent:1",
        type: "agent",
        payload: { name: "reader", role: "worker" },
      }),
    );
    store.append(
      createContextNode({
        id: "agent:2",
        type: "agent",
        payload: { name: "manager", role: "manager" },
      }),
    );

    const worker = store.findAgentByRole("worker");
    expect(worker?.payload.name).toBe("reader");

    const manager = store.findAgentByRole("manager");
    expect(manager?.payload.name).toBe("manager");

    expect(store.findAgentByRole("researcher")).toBeUndefined();
  });
});
