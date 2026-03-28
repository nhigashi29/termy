import { createContextId } from "./context-identity.js";
import { createContextNode } from "./context.js";
import type { AnyContext, ContextId, Task } from "./context-types.js";
import type { ContextStore } from "./context-store.js";
import type { Agent } from "./agent.js";

export interface ExecutionEngine {
  start(): () => void;
  tick(): Promise<void>;
  waitForTask(taskId: ContextId): Promise<void>;
}

export type WorkerConfig = {
  agentId: ContextId;
  agent: Agent;
};

export type AgentFactory = (agentId: ContextId, store: ContextStore) => Agent | Promise<Agent>;

export type CreateExecutionEngineInput = {
  store: ContextStore;
  workers?: WorkerConfig[];
  agentFactory?: AgentFactory;
};

export function createExecutionEngine(input: CreateExecutionEngineInput): ExecutionEngine {
  const { store, workers = [], agentFactory } = input;

  const workersByAgentId = new Map(workers.map((w) => [w.agentId, w]));
  const taskWaiters = new Map<ContextId, { resolve: () => void; reject: (err: Error) => void }>();

  async function resolveWorker(agentId: ContextId): Promise<WorkerConfig | undefined> {
    const existing = workersByAgentId.get(agentId);
    if (existing) return existing;

    if (!agentFactory) return undefined;

    const agent = await agentFactory(agentId, store);
    const worker: WorkerConfig = { agentId, agent };
    workersByAgentId.set(agentId, worker);
    return worker;
  }

  function buildWorkerContexts(task: Task, workerAgentId: ContextId, workerThreadId: ContextId): AnyContext[] {
    const contexts: AnyContext[] = [];

    // 1. Agent identity — who am I?
    const agentContext = store.get(workerAgentId);
    if (agentContext) {
      contexts.push(agentContext);
    }

    // 2. Task context — what am I working on?
    contexts.push(task);

    // 3. User instruction as a message
    contexts.push(
      createContextNode({
        id: createContextId(),
        type: "message",
        payload: {
          role: "user" as const,
          text: task.payload.instruction,
          threadId: workerThreadId,
        },
      }),
    );

    return contexts;
  }

  async function runTask(task: Task): Promise<void> {
    const worker = await resolveWorker(task.payload.assignedTo);
    if (!worker) return;

    const workerThreadId = createContextId();

    store.append(
      createContextNode({
        id: createContextId(),
        type: "agent-status",
        payload: {
          agentId: worker.agentId,
          status: "running" as const,
          taskId: task.id,
          threadId: workerThreadId,
        },
      }),
    );

    store.append(
      createContextNode({
        id: createContextId(),
        type: "task-status",
        payload: { taskId: task.id, status: "in-progress" as const },
      }),
    );

    try {
      const workerContexts = buildWorkerContexts(task, worker.agentId, workerThreadId);

      const result = await worker.agent.run({
        threadId: workerThreadId,
        contexts: workerContexts,
      });

      const assistantMessage = result.contexts.find(
        (c): c is import("./context-types.js").Message =>
          c.type === "message" && c.payload.role === "assistant",
      );

      store.append(
        createContextNode({
          id: createContextId(),
          type: "task-result",
          payload: {
            taskId: task.id,
            threadId: workerThreadId,
            output: assistantMessage ? assistantMessage.payload.text : "(no result)",
          },
        }),
      );

      store.append(
        createContextNode({
          id: createContextId(),
          type: "task-status",
          payload: { taskId: task.id, status: "done" as const },
        }),
      );
    } catch (error) {
      store.append(
        createContextNode({
          id: createContextId(),
          type: "task-status",
          payload: {
            taskId: task.id,
            status: "failed" as const,
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    } finally {
      store.append(
        createContextNode({
          id: createContextId(),
          type: "agent-status",
          payload: {
            agentId: worker.agentId,
            status: "idle" as const,
          },
        }),
      );
    }
  }

  // Queue for serializing task execution
  let running = false;
  const queue: Task[] = [];

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const task = queue.shift()!;
        await runTask(task);
      }
    } finally {
      running = false;
    }
  }

  function enqueue(task: Task): void {
    queue.push(task);
    void drain();
  }

  return {
    start() {
      return store.subscribe((context) => {
        if (context.type === "task") {
          // Accept tasks for known workers or when agentFactory can create workers dynamically
          if (workersByAgentId.has(context.payload.assignedTo) || agentFactory) {
            enqueue(context as Task);
          }
        }
      });
    },

    async tick() {
      // Collect all pending tasks: from known workers + any unresolved agents (for factory)
      const seenAgentIds = new Set(workers.map((w) => w.agentId));
      const allTasks: Task[] = [];

      for (const worker of workers) {
        allTasks.push(...store.listPendingTasks(worker.agentId));
      }

      // Also check tasks assigned to agents not yet in workersByAgentId (dynamic)
      if (agentFactory) {
        const storeTasks = store.list().filter(
          (c): c is Task => c.type === "task" && !seenAgentIds.has(c.payload.assignedTo),
        );
        for (const task of storeTasks) {
          const status = store.latestTaskStatus(task.id);
          if (!status || status.payload.status === "pending") {
            allTasks.push(task);
          }
        }
      }

      for (const task of allTasks) {
        await runTask(task);
      }
    },

    waitForTask(taskId) {
      // Check if already done/failed
      const current = store.latestTaskStatus(taskId);
      if (current && (current.payload.status === "done" || current.payload.status === "failed")) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve, reject) => {
        taskWaiters.set(taskId, { resolve, reject });

        const unsub = store.subscribe((context) => {
          if (
            context.type === "task-status" &&
            context.payload.taskId === taskId &&
            (context.payload.status === "done" || context.payload.status === "failed")
          ) {
            unsub();
            taskWaiters.delete(taskId);
            resolve();
          }
        });
      });
    },
  };
}
