import { describe, expect, it } from "vitest";

import { createContextNode } from "./index.js";
import { conversationProjection, fullProjection, managerProjection, workerProjection } from "./projection.js";

describe("projection", () => {
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
        text: "README を見て",
        threadId: "thread:1",
      },
    }),
    createContextNode({
      id: "toolcall:1",
      type: "tool-call",
      payload: {
        tool: "read",
        args: { path: "README.md" },
        threadId: "thread:1",
      },
    }),
    createContextNode({
      id: "toolresult:1",
      type: "tool-result",
      payload: {
        output: "# hello",
        threadId: "thread:1",
        toolCallId: "toolcall:1",
        isError: false,
      },
    }),
  ];

  it("conversationProjection excludes tool activity", () => {
    const project = conversationProjection();
    expect(project(contexts, "thread:1")).toEqual({
      systemPrompt: undefined,
      transcript: "thread thread:1\nuser: README を見て",
    });
  });

  it("conversationProjection passes through systemPrompt", () => {
    const project = conversationProjection("Be concise.");
    expect(project(contexts, "thread:1")).toEqual({
      systemPrompt: "Be concise.",
      transcript: "thread thread:1\nuser: README を見て",
    });
  });

  it("fullProjection includes tool activity", () => {
    const project = fullProjection("Be concise.");
    expect(project(contexts, "thread:1")).toEqual({
      systemPrompt: "Be concise.",
      transcript:
        'thread thread:1\nuser: README を見て\ntool-call read {"path":"README.md"}\ntool-result # hello',
    });
  });

  describe("managerProjection", () => {
    it("includes agent and agent-status globally plus thread-scoped messages", () => {
      const allContexts = [
        createContextNode({
          id: "agent:reader",
          type: "agent",
          payload: { name: "reader", role: "worker" },
        }),
        createContextNode({
          id: "agent:researcher",
          type: "agent",
          payload: { name: "researcher", role: "worker" },
        }),
        createContextNode({
          id: "as:1",
          type: "agent-status",
          payload: { agentId: "agent:reader", status: "idle" as const },
        }),
        createContextNode({
          id: "as:2",
          type: "agent-status",
          payload: { agentId: "agent:researcher", status: "running" as const, taskId: "task:1" },
        }),
        createContextNode({
          id: "thread:main",
          type: "thread",
          payload: { name: "main" },
        }),
        createContextNode({
          id: "msg:1",
          type: "message",
          payload: { role: "user" as const, text: "README.mdを要約して", threadId: "thread:main" },
        }),
        createContextNode({
          id: "msg:other",
          type: "message",
          payload: { role: "user" as const, text: "other thread", threadId: "thread:other" },
        }),
        createContextNode({
          id: "task:1",
          type: "task",
          payload: {
            parentThreadId: "thread:main",
            assignedTo: "agent:researcher",
            instruction: "research this",
          },
        }),
        createContextNode({
          id: "notification:1",
          type: "notification",
          payload: {
            kind: "task-completed" as const,
            taskId: "task:1",
            message: "task task:1 completed",
          },
        }),
      ];

      const project = managerProjection("You are a manager.");
      const result = project(allContexts, "thread:main");

      expect(result.systemPrompt).toBe("You are a manager.");
      // Should include agents and agent-status (global)
      expect(result.transcript).toContain("agent reader (worker)");
      expect(result.transcript).toContain("agent researcher (worker)");
      expect(result.transcript).toContain("agent-status agent:reader idle");
      expect(result.transcript).toContain("agent-status agent:researcher running");
      // Should include thread-scoped messages
      expect(result.transcript).toContain("user: README.mdを要約して");
      // Should NOT include other thread messages
      expect(result.transcript).not.toContain("other thread");
      // Should include task and notification (global)
      expect(result.transcript).toContain("task task:1: research this");
      expect(result.transcript).toContain("notification task-completed task:task:1 task task:1 completed");
    });

    it("works with no agents in context", () => {
      const project = managerProjection();
      const result = project(contexts, "thread:1");
      expect(result.transcript).toContain("user: README を見て");
      expect(result.transcript).not.toContain("tool-call");
    });

    it("includes reply-request contexts for the active thread", () => {
      const allContexts = [
        createContextNode({
          id: "thread:reply",
          type: "thread",
          payload: {},
        }),
        createContextNode({
          id: "reply:1",
          type: "reply-request",
          payload: {
            threadId: "thread:reply",
            requestedFrom: "agent:manager",
            requestedBy: "agent:worker",
            message: "Need clarification",
          },
        }),
      ];

      const project = managerProjection();
      const result = project(allContexts, "thread:reply");
      expect(result.transcript).toContain("reply-request from:agent:worker to:agent:manager Need clarification");
    });

    it("includes meeting thread state and turns", () => {
      const allContexts = [
        createContextNode({
          id: "thread:meeting",
          type: "thread",
          payload: {
            name: "design review",
            mode: "meeting" as const,
            participantIds: ["agent:manager", "agent:reviewer"],
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
            objective: "Review design",
          },
        }),
        createContextNode({
          id: "meeting-turn:1",
          type: "meeting-turn",
          payload: {
            threadId: "thread:meeting",
            requestedFrom: "agent:reviewer",
            requestedBy: "agent:manager",
            agenda: "Give feedback",
          },
        }),
      ];

      const result = managerProjection()(allContexts, "thread:meeting");
      expect(result.transcript).toContain("thread design review (meeting) turn:manager-mediated");
      expect(result.transcript).toContain("meeting-state open facilitator:agent:manager Review design");
      expect(result.transcript).toContain("meeting-turn from:agent:manager to:agent:reviewer Give feedback");
    });
  });

  describe("workerProjection", () => {
    it("includes agent identity, task context, and thread messages with tool activity", () => {
      const workerContexts = [
        createContextNode({
          id: "agent:reader",
          type: "agent",
          payload: { name: "reader", role: "worker" },
        }),
        createContextNode({
          id: "task:1",
          type: "task",
          payload: {
            parentThreadId: "thread:main",
            assignedTo: "agent:reader",
            instruction: "summarize README",
          },
        }),
        createContextNode({
          id: "thread:worker",
          type: "thread",
          payload: {},
        }),
        createContextNode({
          id: "msg:1",
          type: "message",
          payload: { role: "user" as const, text: "summarize README", threadId: "thread:worker" },
        }),
        createContextNode({
          id: "tc:1",
          type: "tool-call",
          payload: { tool: "read", args: { path: "README.md" }, threadId: "thread:worker" },
        }),
        createContextNode({
          id: "tr:1",
          type: "tool-result",
          payload: { output: "# Project", threadId: "thread:worker", toolCallId: "tc:1", isError: false },
        }),
      ];

      const project = workerProjection("You are a worker.");
      const result = project(workerContexts, "thread:worker");

      expect(result.systemPrompt).toBe("You are a worker.");
      // Identity
      expect(result.transcript).toContain("agent reader (worker)");
      // Task
      expect(result.transcript).toContain("task task:1: summarize README");
      // Thread messages + tool activity
      expect(result.transcript).toContain("user: summarize README");
      expect(result.transcript).toContain('tool-call read {"path":"README.md"}');
      expect(result.transcript).toContain("tool-result # Project");
    });

    it("includes reply-request context for the current thread", () => {
      const workerContexts = [
        createContextNode({
          id: "agent:reader",
          type: "agent",
          payload: { name: "reader", role: "worker" },
        }),
        createContextNode({
          id: "thread:worker",
          type: "thread",
          payload: {},
        }),
        createContextNode({
          id: "reply:1",
          type: "reply-request",
          payload: {
            threadId: "thread:worker",
            requestedFrom: "agent:reader",
            requestedBy: "agent:manager",
            message: "Please answer",
          },
        }),
      ];

      const result = workerProjection()(workerContexts, "thread:worker");
      expect(result.transcript).toContain("reply-request from:agent:manager to:agent:reader Please answer");
    });

    it("excludes messages from other threads", () => {
      const workerContexts = [
        createContextNode({
          id: "msg:1",
          type: "message",
          payload: { role: "user" as const, text: "my thread", threadId: "thread:worker" },
        }),
        createContextNode({
          id: "msg:2",
          type: "message",
          payload: { role: "user" as const, text: "other thread", threadId: "thread:other" },
        }),
      ];

      const project = workerProjection();
      const result = project(workerContexts, "thread:worker");

      expect(result.transcript).toContain("my thread");
      expect(result.transcript).not.toContain("other thread");
    });
  });
});
