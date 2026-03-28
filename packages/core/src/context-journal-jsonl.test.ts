import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createContextNode, createJsonlContextJournal, loadContextsFromJsonl } from "./index.js";

describe("context-journal-jsonl", () => {
  it("appends contexts as jsonl and loads them back", () => {
    const dir = mkdtempSync(join(tmpdir(), "termy-context-journal-"));
    const path = join(dir, "session.jsonl");
    const thread = createContextNode({
      id: "thread:1",
      type: "thread",
      payload: {},
    });
    const message = createContextNode({
      id: "message:1",
      type: "message",
      payload: {
        role: "user" as const,
        text: "hello",
        threadId: "thread:1",
      },
    });

    const journal = createJsonlContextJournal(path);
    journal.appendMany([thread, message]);

    const restored = loadContextsFromJsonl(path);

    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ id: "thread:1", type: "thread" });
    expect(restored[1]).toMatchObject({
      id: "message:1",
      type: "message",
      payload: {
        role: "user",
        text: "hello",
        threadId: "thread:1",
      },
    });
    expect(restored[0]?.createdAt).toBeInstanceOf(Date);
    expect(restored[1]?.createdAt).toBeInstanceOf(Date);
  });
});
