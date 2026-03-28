import { toContextText } from "./context-text.js";
import type { AnyContext, ContextId } from "./context-types.js";

export type ProjectionResult = {
  systemPrompt?: string;
  transcript: string;
};

export type Projection = (contexts: AnyContext[], threadId: ContextId) => ProjectionResult;

function projectByTypes(
  contexts: AnyContext[],
  threadId: ContextId,
  types: Set<string>,
): string {
  return contexts
    .filter((context) => {
      if (!types.has(context.type)) return false;

      if (context.type === "thread") {
        return context.id === threadId;
      }

      if (
        context.type === "message" ||
        context.type === "tool-call" ||
        context.type === "tool-result"
      ) {
        return context.payload.threadId === threadId;
      }

      if (context.type === "task" || context.type === "task-status" || context.type === "task-result") {
        return true;
      }

      return true;
    })
    .map(toContextText)
    .join("\n");
}

export function conversationProjection(systemPrompt?: string): Projection {
  const types = new Set(["thread", "message", "task", "task-status", "task-result"]);
  return (contexts, threadId) => ({
    systemPrompt,
    transcript: projectByTypes(contexts, threadId, types),
  });
}

export function fullProjection(systemPrompt?: string): Projection {
  const types = new Set(["thread", "message", "tool-call", "tool-result", "task", "task-status", "task-result"]);
  return (contexts, threadId) => ({
    systemPrompt,
    transcript: projectByTypes(contexts, threadId, types),
  });
}

/**
 * Manager projection: includes global agent/agent-status contexts + thread-scoped contexts.
 * Gives the manager visibility into who exists and what they're doing.
 */
export function managerProjection(systemPrompt?: string): Projection {
  return (contexts, threadId) => {
    const agents = contexts.filter(
      (c) => c.type === "agent" || c.type === "agent-status",
    );

    const threadTypes = new Set(["thread", "message", "task", "task-status", "task-result"]);
    const thread = contexts.filter((c) => {
      if (!threadTypes.has(c.type)) return false;

      if (c.type === "thread") return c.id === threadId;
      if (c.type === "message") return c.payload.threadId === threadId;
      // task, task-status, task-result are global (not thread-scoped)
      if (c.type === "task" || c.type === "task-status" || c.type === "task-result") return true;

      return false;
    });

    const parts = [...agents, ...thread].map(toContextText);

    return {
      systemPrompt,
      transcript: parts.join("\n"),
    };
  };
}

/**
 * Worker projection: includes agent identity + task context + thread messages.
 * Gives the worker awareness of who it is and what task it's working on.
 */
export function workerProjection(systemPrompt?: string): Projection {
  return (contexts, threadId) => {
    const identity = contexts.filter((c) => c.type === "agent");
    const tasks = contexts.filter(
      (c) => c.type === "task" || c.type === "task-status",
    );
    const thread = contexts.filter((c) => {
      if (c.type === "thread") return c.id === threadId;
      if (
        c.type === "message" ||
        c.type === "tool-call" ||
        c.type === "tool-result"
      ) {
        return (c.payload as { threadId?: string }).threadId === threadId;
      }
      return false;
    });

    const parts = [...identity, ...tasks, ...thread].map(toContextText);

    return {
      systemPrompt,
      transcript: parts.join("\n"),
    };
  };
}
