import { describe, expect, it, vi } from "vitest";

import {
  createContextNode,
  createContextStore,
  createExecutionEngine,
  type AgentFactory,
  type PiRuntime,
} from "./index.js";
import { createAgent } from "./agent.js";
import { conversationProjection, workerProjection } from "./projection.js";

function makeWorkerAgent(store: ReturnType<typeof createContextStore>, runtime: PiRuntime, agentId: string) {
  return createAgent({
    id: agentId,
    store,
    runtime,
    projection: conversationProjection(),
  });
}

describe("execution-engine", () => {
  it("picks up a pending task, runs the worker, and appends result and status", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "worker output" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    store.append(
      createContextNode({
        id: "task:1",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "summarize README",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    await engine.tick();

    expect(runtime.run).toHaveBeenCalledOnce();

    const results = store.listTaskResults("task:1");
    expect(results).toHaveLength(1);
    expect(results[0].payload.output).toBe("worker output");

    const status = store.latestTaskStatus("task:1");
    expect(status?.payload.status).toBe("done");
  });

  it("marks the task as failed when the worker throws", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    store.append(
      createContextNode({
        id: "task:2",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "fail please",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    await engine.tick();

    const status = store.latestTaskStatus("task:2");
    expect(status?.payload.status).toBe("failed");
    expect(status?.payload.reason).toBe("boom");
    expect(store.listTaskResults("task:2")).toHaveLength(0);
  });

  it("does not re-run tasks that are already done", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "done" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    store.append(
      createContextNode({
        id: "task:3",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "do once",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    await engine.tick();
    await engine.tick();

    expect(runtime.run).toHaveBeenCalledOnce();
  });

  it("emits agent-status running/idle around task execution", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "ok" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    store.append(
      createContextNode({
        id: "task:4",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "check status",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    await engine.tick();

    const statuses = store
      .list()
      .filter(
        (c): c is import("./context-types.js").AgentStatus =>
          c.type === "agent-status" && c.payload.agentId === workerId,
      );
    expect(statuses).toHaveLength(2);
    expect(statuses[0].payload.status).toBe("running");
    expect(statuses[0].payload.taskId).toBe("task:4");
    expect(statuses[1].payload.status).toBe("idle");

    const latest = store.latestAgentStatus(workerId);
    expect(latest?.payload.status).toBe("idle");
  });

  it("emits notifications for task lifecycle", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "ok" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    store.append(
      createContextNode({
        id: "task:n1",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "notify me",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    await engine.tick();

    const notifications = store.listNotifications();
    expect(notifications.map((n) => n.payload.kind)).toEqual([
      "agent-busy",
      "task-completed",
      "agent-idle",
    ]);
    expect(notifications[1].payload.taskId).toBe("task:n1");
  });

  it("emits failure notifications when task fails", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    store.append(
      createContextNode({
        id: "task:n2",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "fail and notify",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    await engine.tick();

    const notifications = store.listNotifications();
    expect(notifications.map((n) => n.payload.kind)).toEqual([
      "agent-busy",
      "task-failed",
      "agent-idle",
    ]);
    expect(notifications[1].payload.message).toBe("boom");
  });

  it("runs subscribed reactive agents on matching notifications using the orchestration thread", async () => {
    const workerRuntime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "worker output" }),
    };
    const managerRuntime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "manager collected result" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";
    const managerId = "agent:manager";

    store.append(
      createContextNode({
        id: managerId,
        type: "agent",
        payload: { name: "manager", role: "manager" },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, workerRuntime, workerId),
        },
      ],
      reactiveAgents: [
        {
          agentId: managerId,
          agent: createAgent({
            id: managerId,
            store,
            runtime: managerRuntime,
            projection: conversationProjection(),
          }),
        },
      ],
      subscriptions: [
        {
          subscriberAgentId: managerId,
          kinds: ["task-completed"],
        },
      ],
    });

    const stop = engine.start();

    store.append(
      createContextNode({
        id: "task:reactive",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "do work",
        },
      }),
    );

    await engine.waitForTask("task:reactive");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(managerRuntime.run).toHaveBeenCalledOnce();
    const orchestrationThread = store.get("thread:runtime-control");
    expect(orchestrationThread?.type).toBe("thread");

    const runtimeMessages = store
      .listThread("thread:runtime-control")
      .filter((context) => context.type === "message");
    expect(runtimeMessages).toHaveLength(1);
    expect(runtimeMessages[0]).toMatchObject({
      type: "message",
      payload: { role: "assistant", text: "manager collected result" },
    });

    stop();
  });

  it("defers notification reactions while the subscriber is already marked running", async () => {
    const managerRuntime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "deferred manager reaction" }),
    };

    const store = createContextStore();
    const managerId = "agent:manager";

    store.append(
      createContextNode({
        id: managerId,
        type: "agent",
        payload: { name: "manager", role: "manager" },
      }),
    );

    store.append(
      createContextNode({
        id: "agent-status:running",
        type: "agent-status",
        payload: { agentId: managerId, status: "running" as const },
      }),
    );

    const engine = createExecutionEngine({
      store,
      reactiveAgents: [
        {
          agentId: managerId,
          agent: createAgent({
            id: managerId,
            store,
            runtime: managerRuntime,
            projection: conversationProjection(),
          }),
        },
      ],
      subscriptions: [
        {
          subscriberAgentId: managerId,
          kinds: ["task-completed"],
        },
      ],
    });

    const stop = engine.start();

    store.append(
      createContextNode({
        id: "notification:1",
        type: "notification",
        payload: { kind: "task-completed", taskId: "task:1" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(managerRuntime.run).not.toHaveBeenCalled();

    store.append(
      createContextNode({
        id: "agent-status:idle",
        type: "agent-status",
        payload: { agentId: managerId, status: "idle" as const },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(managerRuntime.run).toHaveBeenCalledOnce();

    stop();
  });

  it("runs reply-request reactions on the requested thread", async () => {
    const managerRuntime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "Here is the clarification." }),
    };

    const store = createContextStore();
    const managerId = "agent:manager";

    store.append(
      createContextNode({
        id: managerId,
        type: "agent",
        payload: { name: "manager", role: "manager" },
      }),
    );
    store.append(createContextNode({ id: "thread:clarify", type: "thread", payload: {} }));
    store.append(
      createContextNode({
        id: "agent-status:waiting",
        type: "agent-status",
        payload: {
          agentId: "agent:worker",
          status: "waiting" as const,
          taskId: "task:1",
          threadId: "thread:clarify",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      reactiveAgents: [
        {
          agentId: managerId,
          agent: createAgent({
            id: managerId,
            store,
            runtime: managerRuntime,
            projection: conversationProjection(),
          }),
        },
      ],
    });

    const stop = engine.start();

    store.append(
      createContextNode({
        id: "reply:1",
        type: "reply-request",
        createdBy: "agent:worker",
        payload: {
          threadId: "thread:clarify",
          requestedFrom: managerId,
          requestedBy: "agent:worker",
          taskId: "task:1",
          message: "Need clarification",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(managerRuntime.run).toHaveBeenCalledOnce();
    const threadMessages = store
      .listThread("thread:clarify")
      .filter((context) => context.type === "message");
    expect(threadMessages).toHaveLength(1);
    expect(threadMessages[0]).toMatchObject({
      type: "message",
      payload: { role: "assistant", text: "Here is the clarification." },
    });

    expect(store.latestAgentStatus("agent:worker")?.payload.status).toBe("idle");
    expect(
      store
        .listNotifications()
        .some((notification) => notification.payload.kind === "reply-available" && notification.payload.targetAgentId === "agent:worker"),
    ).toBe(true);

    stop();
  });

  it("resumes the same task thread after clarification becomes available", async () => {
    const store = createContextStore();
    const workerId = "agent:worker";
    const managerId = "agent:manager";
    const workerThreadId = "thread:worker-task";

    store.append(
      createContextNode({
        id: managerId,
        type: "agent",
        payload: { name: "manager", role: "manager" },
      }),
    );

    const workerRuntime: PiRuntime = {
      run: vi
        .fn()
        .mockImplementationOnce(async () => {
          store.appendMany([
            createContextNode({
              id: "agent-status:waiting-1",
              type: "agent-status",
              payload: {
                agentId: workerId,
                status: "waiting" as const,
                taskId: "task:clarify",
                threadId: workerThreadId,
              },
            }),
            createContextNode({
              id: "reply-request:1",
              type: "reply-request",
              createdBy: workerId,
              payload: {
                threadId: workerThreadId,
                requestedFrom: managerId,
                requestedBy: workerId,
                taskId: "task:clarify",
                message: "Need clarification",
              },
            }),
          ]);
          return { output: "waiting for clarification" };
        })
        .mockImplementationOnce(async (request) => {
          expect(request.input).toContain("Need clarification");
          expect(request.input).toContain("assistant: Clarified requirement");
          return { output: "final answer" };
        }),
    };

    const managerRuntime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "Clarified requirement" }),
    };

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: createAgent({
            id: workerId,
            store,
            runtime: workerRuntime,
            projection: workerProjection(),
          }),
        },
      ],
      reactiveAgents: [
        {
          agentId: managerId,
          agent: createAgent({
            id: managerId,
            store,
            runtime: managerRuntime,
            projection: conversationProjection(),
          }),
        },
      ],
    });

    const stop = engine.start();

    store.appendMany([
      createContextNode({ id: workerThreadId, type: "thread", payload: {} }),
      createContextNode({
        id: "task:clarify",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          workerThreadId,
          assignedTo: workerId,
          instruction: "do the task",
        },
      }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(workerRuntime.run).toHaveBeenCalledTimes(2);
    expect(managerRuntime.run).toHaveBeenCalledOnce();
    expect(store.latestTaskStatus("task:clarify")?.payload.status).toBe("done");
    const results = store.listTaskResults("task:clarify");
    expect(results.at(-1)?.payload.output).toBe("final answer");

    stop();
  });

  it("dispatches meeting turns to participants on the meeting thread", async () => {
    const reviewerId = "agent:reviewer";
    const reviewerRuntime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "I have reviewed the proposal." }),
    };

    const store = createContextStore();
    store.append(
      createContextNode({
        id: reviewerId,
        type: "agent",
        payload: { name: "reviewer", role: "reviewer" },
      }),
    );
    store.appendMany([
      createContextNode({
        id: "thread:meeting",
        type: "thread",
        payload: {
          name: "design review",
          mode: "meeting" as const,
          participantIds: ["agent:manager", reviewerId],
          turnPolicy: "manager-mediated" as const,
        },
      }),
      createContextNode({
        id: "meeting-state:1",
        type: "meeting-state",
        payload: {
          threadId: "thread:meeting",
          status: "open" as const,
          facilitatorId: "agent:manager",
          objective: "Review the design",
        },
      }),
    ]);

    const engine = createExecutionEngine({
      store,
      reactiveAgents: [
        {
          agentId: reviewerId,
          agent: createAgent({
            id: reviewerId,
            store,
            runtime: reviewerRuntime,
            projection: conversationProjection(),
          }),
        },
      ],
    });

    const stop = engine.start();

    store.append(
      createContextNode({
        id: "meeting-turn:1",
        type: "meeting-turn",
        payload: {
          threadId: "thread:meeting",
          requestedFrom: reviewerId,
          requestedBy: "agent:manager",
          agenda: "Give your review",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reviewerRuntime.run).toHaveBeenCalledOnce();
    const meetingMessages = store
      .listThread("thread:meeting")
      .filter((context) => context.type === "message");
    expect(meetingMessages.at(-1)).toMatchObject({
      type: "message",
      payload: { role: "assistant", text: "I have reviewed the proposal." },
    });

    stop();
  });

  it("dispatches meeting turns to worker participants via worker resolution", async () => {
    const reviewerId = "agent:reviewer";
    const reviewerRuntime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "Worker meeting contribution." }),
    };

    const store = createContextStore();
    store.append(
      createContextNode({
        id: reviewerId,
        type: "agent",
        payload: { name: "reviewer", role: "reviewer" },
      }),
    );
    store.appendMany([
      createContextNode({
        id: "thread:meeting",
        type: "thread",
        payload: {
          name: "design review",
          mode: "meeting" as const,
          participantIds: ["agent:manager", reviewerId],
          turnPolicy: "manager-mediated" as const,
        },
      }),
      createContextNode({
        id: "meeting-state:1",
        type: "meeting-state",
        payload: {
          threadId: "thread:meeting",
          status: "open" as const,
          facilitatorId: "agent:manager",
          objective: "Review the design",
        },
      }),
    ]);

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: reviewerId,
          agent: makeWorkerAgent(store, reviewerRuntime, reviewerId),
        },
      ],
    });

    const stop = engine.start();

    store.append(
      createContextNode({
        id: "meeting-turn:worker",
        type: "meeting-turn",
        payload: {
          threadId: "thread:meeting",
          requestedFrom: reviewerId,
          requestedBy: "agent:manager",
          agenda: "Give your review",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reviewerRuntime.run).toHaveBeenCalledOnce();
    const meetingMessages = store
      .listThread("thread:meeting")
      .filter((context) => context.type === "message");
    expect(meetingMessages.at(-1)).toMatchObject({
      type: "message",
      payload: { role: "assistant", text: "Worker meeting contribution." },
    });

    stop();
  });

  it("start() auto-dispatches tasks appended to store", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "auto" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    const unsub = engine.start();

    store.append(
      createContextNode({
        id: "task:5",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "auto dispatch",
        },
      }),
    );

    // Wait for async dispatch to complete
    await engine.waitForTask("task:5");

    expect(runtime.run).toHaveBeenCalledOnce();

    const results = store.listTaskResults("task:5");
    expect(results).toHaveLength(1);
    expect(results[0].payload.output).toBe("auto");

    const status = store.latestTaskStatus("task:5");
    expect(status?.payload.status).toBe("done");

    unsub();
  });

  it("waitForTask resolves immediately if task is already done", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "done" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    store.append(
      createContextNode({
        id: "task:6",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "already done",
        },
      }),
    );

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    await engine.tick();

    // Should resolve immediately since task:6 is already done
    await engine.waitForTask("task:6");

    expect(store.latestTaskStatus("task:6")?.payload.status).toBe("done");
  });

  it("start() unsubscribes on cleanup", async () => {
    const runtime: PiRuntime = {
      run: vi.fn().mockResolvedValue({ output: "nope" }),
    };

    const store = createContextStore();
    const workerId = "agent:worker";

    const engine = createExecutionEngine({
      store,
      workers: [
        {
          agentId: workerId,
          agent: makeWorkerAgent(store, runtime, workerId),
        },
      ],
    });

    const unsub = engine.start();
    unsub();

    store.append(
      createContextNode({
        id: "task:7",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          assignedTo: workerId,
          instruction: "should not run",
        },
      }),
    );

    // Give time for potential async dispatch
    await new Promise((r) => setTimeout(r, 50));

    expect(runtime.run).not.toHaveBeenCalled();
  });

  describe("dynamic subagent via agentFactory", () => {
    it("creates a worker dynamically when agentFactory is provided", async () => {
      const runtime: PiRuntime = {
        run: vi.fn().mockResolvedValue({ output: "dynamic result" }),
      };

      const store = createContextStore();
      const dynamicAgentId = "agent:dynamic";

      // Register the agent context in store
      store.append(
        createContextNode({
          id: dynamicAgentId,
          type: "agent",
          payload: { name: "dynamic", role: "researcher" },
        }),
      );

      const agentFactory: AgentFactory = vi.fn((agentId, factoryStore) => {
        return createAgent({
          id: agentId,
          store: factoryStore,
          runtime,
          projection: workerProjection(),
        });
      });

      const engine = createExecutionEngine({
        store,
        agentFactory,
      });

      store.append(
        createContextNode({
          id: "task:dyn1",
          type: "task",
          payload: {
            parentThreadId: "thread:main",
            assignedTo: dynamicAgentId,
            instruction: "research something",
          },
        }),
      );

      await engine.tick();

      expect(agentFactory).toHaveBeenCalledOnce();
      expect(runtime.run).toHaveBeenCalledOnce();

      const results = store.listTaskResults("task:dyn1");
      expect(results).toHaveLength(1);
      expect(results[0].payload.output).toBe("dynamic result");

      const status = store.latestTaskStatus("task:dyn1");
      expect(status?.payload.status).toBe("done");
    });

    it("reuses the dynamically-created worker for subsequent tasks", async () => {
      const runtime: PiRuntime = {
        run: vi.fn().mockResolvedValue({ output: "reused" }),
      };

      const store = createContextStore();
      const dynamicAgentId = "agent:reuse";

      store.append(
        createContextNode({
          id: dynamicAgentId,
          type: "agent",
          payload: { name: "reuse", role: "worker" },
        }),
      );

      const agentFactory: AgentFactory = vi.fn((agentId, factoryStore) => {
        return createAgent({
          id: agentId,
          store: factoryStore,
          runtime,
          projection: workerProjection(),
        });
      });

      const engine = createExecutionEngine({
        store,
        agentFactory,
      });

      store.append(
        createContextNode({
          id: "task:r1",
          type: "task",
          payload: {
            parentThreadId: "thread:main",
            assignedTo: dynamicAgentId,
            instruction: "first task",
          },
        }),
      );

      await engine.tick();

      store.append(
        createContextNode({
          id: "task:r2",
          type: "task",
          payload: {
            parentThreadId: "thread:main",
            assignedTo: dynamicAgentId,
            instruction: "second task",
          },
        }),
      );

      await engine.tick();

      // Factory called only once, runtime called twice
      expect(agentFactory).toHaveBeenCalledOnce();
      expect(runtime.run).toHaveBeenCalledTimes(2);
    });

    it("start() dispatches tasks to dynamic agents via subscribe", async () => {
      const runtime: PiRuntime = {
        run: vi.fn().mockResolvedValue({ output: "auto-dynamic" }),
      };

      const store = createContextStore();
      const dynamicAgentId = "agent:auto";

      store.append(
        createContextNode({
          id: dynamicAgentId,
          type: "agent",
          payload: { name: "auto", role: "worker" },
        }),
      );

      const agentFactory: AgentFactory = (agentId, factoryStore) => {
        return createAgent({
          id: agentId,
          store: factoryStore,
          runtime,
          projection: workerProjection(),
        });
      };

      const engine = createExecutionEngine({
        store,
        agentFactory,
      });

      const unsub = engine.start();

      store.append(
        createContextNode({
          id: "task:auto1",
          type: "task",
          payload: {
            parentThreadId: "thread:main",
            assignedTo: dynamicAgentId,
            instruction: "auto dispatch dynamic",
          },
        }),
      );

      await engine.waitForTask("task:auto1");

      expect(runtime.run).toHaveBeenCalledOnce();
      expect(store.latestTaskStatus("task:auto1")?.payload.status).toBe("done");

      unsub();
    });

    it("worker receives enriched context (identity + task + message)", async () => {
      let receivedInput = "";
      const runtime: PiRuntime = {
        run: vi.fn().mockImplementation(async (input: { input: string }) => {
          receivedInput = input.input;
          return { output: "done" };
        }),
      };

      const store = createContextStore();
      const workerId = "agent:enriched";

      store.append(
        createContextNode({
          id: workerId,
          type: "agent",
          payload: { name: "enriched-worker", role: "worker" },
        }),
      );

      const engine = createExecutionEngine({
        store,
        workers: [
          {
            agentId: workerId,
            agent: createAgent({
              id: workerId,
              store,
              runtime,
              projection: workerProjection(),
            }),
          },
        ],
      });

      store.append(
        createContextNode({
          id: "task:enrich",
          type: "task",
          payload: {
            parentThreadId: "thread:main",
            assignedTo: workerId,
            instruction: "do enriched work",
          },
        }),
      );

      await engine.tick();

      // Worker should see its own identity
      expect(receivedInput).toContain("agent enriched-worker (worker)");
      // Worker should see the task
      expect(receivedInput).toContain("task task:enrich: do enriched work");
      // Worker should see the instruction as a user message
      expect(receivedInput).toContain("user: do enriched work");
    });
  });
});
