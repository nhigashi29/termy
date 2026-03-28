import { describe, expect, it } from "vitest";

import { createContextNode, toContextText } from "./index.js";

describe("context-text", () => {
  it("renders message context as text", () => {
    const message = createContextNode({
      id: "message:1",
      type: "message",
      payload: {
        role: "assistant" as const,
        text: "見てみます",
        threadId: "thread:1",
      },
    });

    expect(toContextText(message)).toBe("assistant: 見てみます");
  });

  it("renders tool-call context as text", () => {
    const toolCall = createContextNode({
      id: "toolcall:1",
      type: "tool-call",
      payload: {
        tool: "read",
        args: { path: "src/index.ts" },
      },
    });

    expect(toContextText(toolCall)).toBe(
      'tool-call read {"path":"src/index.ts"}',
    );
  });

  it("renders capability context as text", () => {
    const capability = createContextNode({
      id: "capability:1",
      type: "capability",
      payload: {
        action: "invoke-tool",
        targetType: "tool-call",
      },
    });

    expect(toContextText(capability)).toBe("capability invoke-tool -> tool-call");
  });

  it("renders reply-request context as text", () => {
    const replyRequest = createContextNode({
      id: "reply:1",
      type: "reply-request",
      payload: {
        threadId: "thread:1",
        requestedFrom: "agent:manager",
        requestedBy: "agent:worker",
        taskId: "task:1",
        message: "Need clarification",
      },
    });

    expect(toContextText(replyRequest)).toBe(
      "reply-request from:agent:worker to:agent:manager task:task:1 Need clarification",
    );
  });

  it("renders meeting thread and turn contexts as text", () => {
    const thread = createContextNode({
      id: "thread:meeting",
      type: "thread",
      payload: {
        name: "design sync",
        mode: "meeting" as const,
        turnPolicy: "manager-mediated" as const,
      },
    });
    const meetingTurn = createContextNode({
      id: "meeting-turn:1",
      type: "meeting-turn",
      payload: {
        threadId: "thread:meeting",
        requestedFrom: "agent:reviewer",
        requestedBy: "agent:manager",
        agenda: "Review the proposal",
      },
    });

    expect(toContextText(thread)).toBe("thread design sync (meeting) turn:manager-mediated");
    expect(toContextText(meetingTurn)).toBe(
      "meeting-turn from:agent:manager to:agent:reviewer Review the proposal",
    );
  });
});
