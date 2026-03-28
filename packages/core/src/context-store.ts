import type { AnyContext, ContextId, Message } from "./context-types.js";

export interface ContextStore {
  append(context: AnyContext): void;
  appendMany(contexts: AnyContext[]): void;
  get(id: ContextId): AnyContext | undefined;
  list(): AnyContext[];
  listThread(threadId: ContextId): AnyContext[];
  latestMessage(threadId: ContextId): Message | undefined;
}

function isThreadScopedContext(context: AnyContext, threadId: ContextId): boolean {
  if (context.type === "thread") {
    return context.id === threadId;
  }

  if (context.type === "message") {
    return context.payload.threadId === threadId;
  }

  if (context.type === "tool-call" || context.type === "tool-result") {
    return context.payload.threadId === threadId;
  }

  return false;
}

export function createContextStore(initialContexts: AnyContext[] = []): ContextStore {
  const contexts = [...initialContexts];
  const byId = new Map<ContextId, AnyContext>(initialContexts.map((context) => [context.id, context]));

  return {
    append(context) {
      contexts.push(context);
      byId.set(context.id, context);
    },

    appendMany(nextContexts) {
      nextContexts.forEach((context) => {
        contexts.push(context);
        byId.set(context.id, context);
      });
    },

    get(id) {
      return byId.get(id);
    },

    list() {
      return [...contexts];
    },

    listThread(threadId) {
      return contexts.filter((context) => isThreadScopedContext(context, threadId));
    },

    latestMessage(threadId) {
      for (let index = contexts.length - 1; index >= 0; index -= 1) {
        const context = contexts[index];
        if (context.type === "message" && context.payload.threadId === threadId) {
          return context;
        }
      }

      return undefined;
    },
  };
}
