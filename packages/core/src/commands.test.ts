import { describe, expect, it } from "vitest";

import { createContextNode } from "./context.js";
import { createContextStore } from "./context-store.js";
import {
  collectThreadTaskResultsCommand,
  createMeetingCommand,
  getMeetingResultsCommand,
  postThreadMessageCommand,
} from "./commands.js";

describe("commands", () => {
  it("collectThreadTaskResultsCommand fans in task outcomes by parent thread", () => {
    const store = createContextStore();

    store.appendMany([
      createContextNode({ id: "thread:main", type: "thread", payload: {} }),
      createContextNode({
        id: "task:1",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          workerThreadId: "thread:w1",
          assignedTo: "agent:reader",
          instruction: "read file",
          title: "reader",
        },
      }),
      createContextNode({
        id: "task:2",
        type: "task",
        payload: {
          parentThreadId: "thread:main",
          workerThreadId: "thread:w2",
          assignedTo: "agent:reviewer",
          instruction: "review plan",
          title: "reviewer",
        },
      }),
      createContextNode({
        id: "task-status:1",
        type: "task-status",
        payload: { taskId: "task:1", status: "done" as const },
      }),
      createContextNode({
        id: "task-result:1",
        type: "task-result",
        payload: { taskId: "task:1", threadId: "thread:w1", output: "reader done" },
      }),
      createContextNode({
        id: "task-status:2",
        type: "task-status",
        payload: { taskId: "task:2", status: "failed" as const, reason: "boom" },
      }),
    ]);

    const result = collectThreadTaskResultsCommand({ store, threadId: "thread:main" });

    expect(result.counts).toEqual({
      total: 2,
      pending: 0,
      inProgress: 0,
      done: 1,
      failed: 1,
    });
    expect(result.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "task:1", status: "done", output: "reader done" }),
        expect.objectContaining({ taskId: "task:2", status: "failed", reason: "boom" }),
      ]),
    );
  });

  it("createMeetingCommand appends an opening facilitator message", () => {
    const store = createContextStore();

    const result = createMeetingCommand({
      store,
      managerId: "agent:manager",
      title: "Design review",
      objective: "Review the proposal",
      participantRoles: ["reviewer"],
    });

    const messages = store.listThread(result.threadId).filter((context) => context.type === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "message",
      createdBy: "agent:manager",
      payload: { role: "assistant", text: expect.stringContaining("Facilitator opening") },
    });
  });

  it("getMeetingResultsCommand reports responded and pending participants", () => {
    const store = createContextStore();

    store.appendMany([
      createContextNode({
        id: "thread:meeting",
        type: "thread",
        payload: {
          mode: "meeting" as const,
          participantIds: ["agent:manager", "agent:reader", "agent:reviewer"],
        },
      }),
      createContextNode({
        id: "meeting-turn:1",
        type: "meeting-turn",
        payload: {
          threadId: "thread:meeting",
          requestedFrom: "agent:reader",
          requestedBy: "agent:manager",
          agenda: "say something",
        },
      }),
      createContextNode({
        id: "meeting-turn:2",
        type: "meeting-turn",
        payload: {
          threadId: "thread:meeting",
          requestedFrom: "agent:reviewer",
          requestedBy: "agent:manager",
          agenda: "say something else",
        },
      }),
      createContextNode({
        id: "message:1",
        type: "message",
        createdBy: "agent:reader",
        payload: {
          role: "assistant" as const,
          threadId: "thread:meeting",
          text: "reader here",
        },
      }),
    ]);

    const result = getMeetingResultsCommand({ store, threadId: "thread:meeting" });

    expect(result.requestedParticipantIds).toEqual(["agent:reader", "agent:reviewer"]);
    expect(result.respondedParticipantIds).toContain("agent:reader");
    expect(result.pendingParticipantIds).toEqual(["agent:reviewer"]);
    expect(result.isComplete).toBe(false);
  });

  it("postThreadMessageCommand appends a message to the target thread", () => {
    const store = createContextStore();
    store.append(createContextNode({ id: "thread:main", type: "thread", payload: {} }));

    const result = postThreadMessageCommand({
      store,
      authorId: "agent:manager",
      threadId: "thread:main",
      text: "summary ready",
    });

    expect(result.threadId).toBe("thread:main");
    expect(store.latestMessage("thread:main")?.payload.text).toBe("summary ready");
  });
});
