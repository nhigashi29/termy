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
});
