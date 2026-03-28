import { describe, expect, it } from "vitest";

import { createContextNode, projectContextsToPi, toPiInput } from "./index.js";

describe("pi-projection", () => {
  it("projects only conversation contexts by default", () => {
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

    expect(projectContextsToPi({ contexts, threadId: "thread:1" })).toEqual({
      systemPrompt: undefined,
      transcript: "thread thread:1\nuser: README を見て",
    });
  });

  it("can include tool activity in the projection when requested", () => {
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

    expect(
      toPiInput(contexts, {
        threadId: "thread:1",
        projectionMode: "with-tool-results",
        systemPrompt: "Be concise.",
      }),
    ).toEqual({
      systemPrompt: "Be concise.",
      input:
        'thread thread:1\nuser: README を見て\ntool-call read {"path":"README.md"}\ntool-result # hello',
    });
  });
});
