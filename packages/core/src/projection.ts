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
        context.type === "tool-result" ||
        context.type === "reply-request" ||
        context.type === "meeting-turn" ||
        context.type === "meeting-state"
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
  const types = new Set(["thread", "message", "task", "task-status", "task-result", "notification", "reply-request", "meeting-turn", "meeting-state"]);
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

    const threadTypes = new Set(["thread", "message", "task", "task-status", "task-result", "notification", "reply-request", "meeting-turn", "meeting-state"]);
    const thread = contexts.filter((c) => {
      if (!threadTypes.has(c.type)) return false;

      if (c.type === "thread") return c.id === threadId;
      if (c.type === "message" || c.type === "reply-request" || c.type === "meeting-turn" || c.type === "meeting-state") return c.payload.threadId === threadId;
      if (c.type === "task") return c.payload.parentThreadId === threadId;
      if (c.type === "task-status" || c.type === "task-result" || c.type === "notification") return true;

      return false;
    });

    const parts = [...agents, ...thread].map(toContextText);

    return {
      systemPrompt,
      transcript: parts.join("\n"),
    };
  };
}

export function orchestrationProjection(systemPrompt?: string): Projection {
  return (contexts, threadId) => {
    const included = contexts.filter((context) => {
      if (
        context.type === "agent" ||
        context.type === "agent-status" ||
        context.type === "task" ||
        context.type === "task-status" ||
        context.type === "task-result" ||
        context.type === "notification" ||
        context.type === "meeting-state"
      ) {
        return true;
      }

      if (context.type === "thread") {
        return context.id === threadId;
      }

      if (context.type === "message" || context.type === "reply-request" || context.type === "meeting-turn") {
        return context.payload.threadId === threadId;
      }

      return false;
    });

    return {
      systemPrompt,
      transcript: included.map(toContextText).join("\n"),
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
    const relevantTasks = contexts.filter(
      (c): c is Extract<AnyContext, { type: "task" }> =>
        c.type === "task" && (c.payload.workerThreadId === threadId || c.payload.workerThreadId == null),
    );
    const relevantTaskIds = new Set(relevantTasks.map((task) => task.id));
    const taskContexts = contexts.filter((context) => {
      if (context.type === "task") {
        return context.payload.workerThreadId === threadId || context.payload.workerThreadId == null;
      }

      if (context.type === "task-status" || context.type === "task-result") {
        return relevantTaskIds.has(context.payload.taskId);
      }

      if (context.type === "reply-request" || context.type === "meeting-turn" || context.type === "meeting-state") {
        return context.payload.threadId === threadId;
      }

      return false;
    });
    const thread = contexts.filter((c) => {
      if (c.type === "thread") return c.id === threadId;
      if (
        c.type === "message" ||
        c.type === "tool-call" ||
        c.type === "tool-result" ||
        c.type === "reply-request" ||
        c.type === "meeting-turn" ||
        c.type === "meeting-state"
      ) {
        return (c.payload as { threadId?: string }).threadId === threadId;
      }
      return false;
    });

    const parts = [...identity, ...taskContexts, ...thread].map(toContextText);

    return {
      systemPrompt,
      transcript: parts.join("\n"),
    };
  };
}
