import { v7 as uuidv7 } from "uuid";

import { createContextNode } from "./context.js";
import type { Agent, AnyContext, ContextId, Thread, User } from "./context-types.js";
import type { ContextStore } from "./context-store.js";

export function createContextId(): ContextId {
  return uuidv7();
}

function findContextByTypeAndKey<TContext extends AnyContext>(
  store: ContextStore,
  type: TContext["type"],
  key: string,
): TContext | undefined {
  return store.list().find((context) => {
    if (context.type !== type) {
      return false;
    }

    const payload = context.payload as { key?: string };
    return payload.key === key;
  }) as TContext | undefined;
}

export type EnsureUserContextInput = {
  store: ContextStore;
  key: string;
  name?: string;
};

export function ensureUserContext(input: EnsureUserContextInput): User {
  const existing = findContextByTypeAndKey<User>(input.store, "user", input.key);

  if (existing) {
    return existing;
  }

  const context = createContextNode({
    id: createContextId(),
    type: "user",
    payload: {
      key: input.key,
      name: input.name,
    },
  });

  input.store.append(context);
  return context;
}

export type EnsureAgentContextInput = {
  store: ContextStore;
  key: string;
  name?: string;
  role?: string;
};

export function ensureAgentContext(input: EnsureAgentContextInput): Agent {
  const existing = findContextByTypeAndKey<Agent>(input.store, "agent", input.key);

  if (existing) {
    return existing;
  }

  const context = createContextNode({
    id: createContextId(),
    type: "agent",
    payload: {
      key: input.key,
      name: input.name,
      role: input.role,
    },
  });

  input.store.append(context);
  return context;
}

export type EnsureThreadContextInput = {
  store: ContextStore;
  key: string;
  name?: string;
};

export function ensureThreadContext(input: EnsureThreadContextInput): Thread {
  const existing = findContextByTypeAndKey<Thread>(input.store, "thread", input.key);

  if (existing) {
    return existing;
  }

  const context = createContextNode({
    id: createContextId(),
    type: "thread",
    payload: {
      key: input.key,
      name: input.name,
    },
  });

  input.store.append(context);
  return context;
}
