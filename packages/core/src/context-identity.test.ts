import { describe, expect, it } from "vitest";
import { validate, version } from "uuid";

import {
  createContextId,
  createContextStore,
  ensureAgentContext,
  ensureThreadContext,
  ensureUserContext,
} from "./index.js";

describe("context-identity", () => {
  it("creates uuid v7 context ids", () => {
    const id = createContextId();

    expect(validate(id)).toBe(true);
    expect(version(id)).toBe(7);
  });

  it("reuses actor and thread contexts by key", () => {
    const store = createContextStore();

    const threadA = ensureThreadContext({ store, key: "main", name: "main" });
    const threadB = ensureThreadContext({ store, key: "main", name: "main" });
    const userA = ensureUserContext({ store, key: "cli", name: "cli" });
    const userB = ensureUserContext({ store, key: "cli", name: "cli" });
    const agentA = ensureAgentContext({ store, key: "pi-runtime", name: "pi" });
    const agentB = ensureAgentContext({ store, key: "pi-runtime", name: "pi" });

    expect(threadA.id).toBe(threadB.id);
    expect(userA.id).toBe(userB.id);
    expect(agentA.id).toBe(agentB.id);
    expect(store.list()).toHaveLength(3);
  });
});
