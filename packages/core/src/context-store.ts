import type { ContextJournal } from "./context-journal.js";
import type { AgentContext, AgentStatus, AnyContext, ContextId, Message, Task, TaskResult, TaskStatus, TaskStatusChange } from "./context-types.js";

export interface ContextStore {
  append(context: AnyContext): void;
  appendMany(contexts: AnyContext[]): void;
  get(id: ContextId): AnyContext | undefined;
  list(): AnyContext[];
  listThread(threadId: ContextId): AnyContext[];
  latestMessage(threadId: ContextId): Message | undefined;
  listPendingTasks(agentId: ContextId): Task[];
  latestTaskStatus(taskId: ContextId): TaskStatusChange | undefined;
  listTaskResults(taskId: ContextId): TaskResult[];
  latestAgentStatus(agentId: ContextId): AgentStatus | undefined;
  listAgents(): AgentContext[];
  findAgentByRole(role: string): AgentContext | undefined;
  subscribe(listener: (context: AnyContext) => void): () => void;
}

export type CreateContextStoreOptions = {
  journal?: ContextJournal;
};

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

export function createContextStore(
  initialContexts: AnyContext[] = [],
  options: CreateContextStoreOptions = {},
): ContextStore {
  const contexts = [...initialContexts];
  const byId = new Map<ContextId, AnyContext>(initialContexts.map((context) => [context.id, context]));
  const journal = options.journal;
  const listeners = new Set<(context: AnyContext) => void>();

  function notify(context: AnyContext): void {
    for (const listener of listeners) {
      listener(context);
    }
  }

  return {
    append(context) {
      contexts.push(context);
      byId.set(context.id, context);
      journal?.append(context);
      notify(context);
    },

    appendMany(nextContexts) {
      nextContexts.forEach((context) => {
        contexts.push(context);
        byId.set(context.id, context);
      });
      if (journal && nextContexts.length > 0) {
        journal.appendMany(nextContexts);
      }
      for (const context of nextContexts) {
        notify(context);
      }
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

    listPendingTasks(agentId) {
      return contexts.filter((context): context is Task => {
        if (context.type !== "task") return false;
        if (context.payload.assignedTo !== agentId) return false;
        const status = resolveTaskStatus(contexts, context.id);
        return status === "pending";
      });
    },

    latestTaskStatus(taskId) {
      for (let index = contexts.length - 1; index >= 0; index -= 1) {
        const context = contexts[index];
        if (context.type === "task-status" && context.payload.taskId === taskId) {
          return context as TaskStatusChange;
        }
      }
      return undefined;
    },

    listTaskResults(taskId) {
      return contexts.filter(
        (context): context is TaskResult =>
          context.type === "task-result" && context.payload.taskId === taskId,
      );
    },

    latestAgentStatus(agentId) {
      for (let index = contexts.length - 1; index >= 0; index -= 1) {
        const context = contexts[index];
        if (context.type === "agent-status" && context.payload.agentId === agentId) {
          return context as AgentStatus;
        }
      }
      return undefined;
    },

    listAgents() {
      return contexts.filter(
        (context): context is AgentContext => context.type === "agent",
      );
    },

    findAgentByRole(role) {
      return contexts.find(
        (context): context is AgentContext =>
          context.type === "agent" && context.payload.role === role,
      );
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function resolveTaskStatus(contexts: AnyContext[], taskId: ContextId): TaskStatus {
  for (let index = contexts.length - 1; index >= 0; index -= 1) {
    const context = contexts[index];
    if (context.type === "task-status" && context.payload.taskId === taskId) {
      return (context as TaskStatusChange).payload.status;
    }
  }
  return "pending";
}
