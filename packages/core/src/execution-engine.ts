import { createContextId } from "./context-identity.js";
import { createContextNode } from "./context.js";
import type { AnyContext, ContextId, MeetingTurn, Message, Notification, NotificationSubscription, ReplyRequest, Task } from "./context-types.js";
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

export type ReactiveAgentConfig = {
  agentId: ContextId;
  agent: Agent;
};

export type AgentFactory = (agentId: ContextId, store: ContextStore) => Agent | Promise<Agent>;

type PendingWork =
  | { kind: "task"; task: Task; resume?: boolean }
  | { kind: "notification"; notificationIds: ContextId[] }
  | { kind: "reply"; threadId: ContextId; replyRequestIds: ContextId[] }
  | { kind: "meeting-turn"; threadId: ContextId; meetingTurnIds: ContextId[] };

export type CreateExecutionEngineInput = {
  store: ContextStore;
  workers?: WorkerConfig[];
  reactiveAgents?: ReactiveAgentConfig[];
  subscriptions?: NotificationSubscription[];
  agentFactory?: AgentFactory;
  orchestrationThreadId?: ContextId;
};

export function createExecutionEngine(input: CreateExecutionEngineInput): ExecutionEngine {
  const {
    store,
    workers = [],
    reactiveAgents = [],
    subscriptions = [],
    agentFactory,
    orchestrationThreadId = "thread:runtime-control",
  } = input;

  const workersByAgentId = new Map(workers.map((worker) => [worker.agentId, worker]));
  const reactiveAgentsById = new Map(reactiveAgents.map((agent) => [agent.agentId, agent]));
  const taskWaiters = new Map<ContextId, { resolve: () => void; reject: (err: Error) => void }>();
  const pendingByAgentId = new Map<ContextId, PendingWork[]>();
  const runningAgentIds = new Set<ContextId>();
  const drainPromisesByAgentId = new Map<ContextId, Promise<void>>();
  const enqueuedTaskIds = new Set<ContextId>();
  const taskThreadIds = new Map<ContextId, ContextId>();
  const pendingNotificationIdsByAgentId = new Map<ContextId, Set<ContextId>>();
  const deliveredNotificationIdsByAgentId = new Map<ContextId, Set<ContextId>>();
  const pendingReplyRequestIdsByAgentId = new Map<ContextId, Set<ContextId>>();
  const deliveredReplyRequestIdsByAgentId = new Map<ContextId, Set<ContextId>>();
  const pendingMeetingTurnIdsByAgentId = new Map<ContextId, Set<ContextId>>();
  const deliveredMeetingTurnIdsByAgentId = new Map<ContextId, Set<ContextId>>();

  function ensureOrchestrationThread(): void {
    if (store.get(orchestrationThreadId)) {
      return;
    }

    store.append(
      createContextNode({
        id: orchestrationThreadId,
        type: "thread",
        payload: {
          key: "runtime-control",
          name: "runtime:control",
        },
      }),
    );
  }

  async function resolveWorker(agentId: ContextId): Promise<WorkerConfig | undefined> {
    const existing = workersByAgentId.get(agentId);
    if (existing) return existing;

    if (!agentFactory) return undefined;

    const agent = await agentFactory(agentId, store);
    const worker: WorkerConfig = { agentId, agent };
    workersByAgentId.set(agentId, worker);
    return worker;
  }

  function resolveWorkerThreadId(task: Task): ContextId {
    const existing = taskThreadIds.get(task.id) ?? task.payload.workerThreadId;
    if (existing) {
      taskThreadIds.set(task.id, existing);
      return existing;
    }

    const created = createContextId();
    taskThreadIds.set(task.id, created);
    return created;
  }

  function buildWorkerContexts(task: Task, workerAgentId: ContextId, workerThreadId: ContextId): AnyContext[] {
    const contexts: AnyContext[] = [];
    const agentContext = store.get(workerAgentId);
    if (agentContext) {
      contexts.push(agentContext);
    }

    contexts.push(task);

    const existingThreadContexts = store.listThread(workerThreadId);
    if (existingThreadContexts.length > 0) {
      contexts.push(...existingThreadContexts);
      return contexts;
    }

    contexts.push(
      createContextNode({
        id: workerThreadId,
        type: "thread",
        payload: {},
      }),
    );
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

  function enqueueWork(agentId: ContextId, work: PendingWork): void {
    const queue = pendingByAgentId.get(agentId) ?? [];
    queue.push(work);
    pendingByAgentId.set(agentId, queue);

    const latestStatus = store.latestAgentStatus(agentId);
    if (latestStatus?.payload.status === "running") {
      return;
    }

    void drainAgent(agentId);
  }

  function enqueueNotificationReaction(notification: Notification): void {
    for (const subscription of subscriptions) {
      if (!subscription.kinds.includes(notification.payload.kind)) {
        continue;
      }

      const agentId = subscription.subscriberAgentId;
      const deliveredNotificationIds = deliveredNotificationIdsByAgentId.get(agentId) ?? new Set<ContextId>();
      const pendingNotificationIds = pendingNotificationIdsByAgentId.get(agentId) ?? new Set<ContextId>();
      if (deliveredNotificationIds.has(notification.id) || pendingNotificationIds.has(notification.id)) {
        continue;
      }
      pendingNotificationIds.add(notification.id);
      pendingNotificationIdsByAgentId.set(agentId, pendingNotificationIds);

      const queue = pendingByAgentId.get(agentId) ?? [];
      const existing = queue.find((item) => item.kind === "notification") as
        | { kind: "notification"; notificationIds: ContextId[] }
        | undefined;

      if (existing) {
        existing.notificationIds.push(notification.id);
      } else {
        queue.push({ kind: "notification", notificationIds: [notification.id] });
      }

      pendingByAgentId.set(agentId, queue);

      const latestStatus = store.latestAgentStatus(agentId);
      if (latestStatus?.payload.status !== "running") {
        void drainAgent(agentId);
      }
    }
  }

  function enqueueReplyReaction(replyRequest: ReplyRequest): void {
    const agentId = replyRequest.payload.requestedFrom;
    const deliveredReplyRequestIds = deliveredReplyRequestIdsByAgentId.get(agentId) ?? new Set<ContextId>();
    const pendingReplyRequestIds = pendingReplyRequestIdsByAgentId.get(agentId) ?? new Set<ContextId>();
    if (deliveredReplyRequestIds.has(replyRequest.id) || pendingReplyRequestIds.has(replyRequest.id)) {
      return;
    }

    pendingReplyRequestIds.add(replyRequest.id);
    pendingReplyRequestIdsByAgentId.set(agentId, pendingReplyRequestIds);

    const queue = pendingByAgentId.get(agentId) ?? [];
    const existing = queue.find(
      (item): item is { kind: "reply"; threadId: ContextId; replyRequestIds: ContextId[] } =>
        item.kind === "reply" && item.threadId === replyRequest.payload.threadId,
    );

    if (existing) {
      existing.replyRequestIds.push(replyRequest.id);
    } else {
      queue.push({
        kind: "reply",
        threadId: replyRequest.payload.threadId,
        replyRequestIds: [replyRequest.id],
      });
    }

    pendingByAgentId.set(agentId, queue);

    const latestStatus = store.latestAgentStatus(agentId);
    if (latestStatus?.payload.status !== "running") {
      void drainAgent(agentId);
    }
  }

  function isTaskWaitingForReply(task: Task, workerAgentId: ContextId, workerThreadId: ContextId): boolean {
    const latestWorkerStatus = store.latestAgentStatus(workerAgentId);
    if (
      latestWorkerStatus?.payload.status === "waiting" &&
      latestWorkerStatus.payload.taskId === task.id &&
      latestWorkerStatus.payload.threadId === workerThreadId
    ) {
      return true;
    }

    return store.list().some((context, index, allContexts) => {
      if (context.type !== "reply-request") return false;
      if (context.payload.threadId !== workerThreadId) return false;
      if (context.payload.taskId !== task.id) return false;
      if (context.payload.requestedBy !== workerAgentId) return false;

      return !allContexts.some((candidate, candidateIndex) => {
        if (candidateIndex <= index) return false;
        if (candidate.type !== "message") return false;
        if (candidate.createdBy !== context.payload.requestedFrom) return false;
        return candidate.payload.threadId === workerThreadId;
      });
    });
  }

  function enqueueMeetingTurn(meetingTurn: MeetingTurn): void {
    const agentId = meetingTurn.payload.requestedFrom;
    const deliveredMeetingTurnIds = deliveredMeetingTurnIdsByAgentId.get(agentId) ?? new Set<ContextId>();
    const pendingMeetingTurnIds = pendingMeetingTurnIdsByAgentId.get(agentId) ?? new Set<ContextId>();
    if (deliveredMeetingTurnIds.has(meetingTurn.id) || pendingMeetingTurnIds.has(meetingTurn.id)) {
      return;
    }

    pendingMeetingTurnIds.add(meetingTurn.id);
    pendingMeetingTurnIdsByAgentId.set(agentId, pendingMeetingTurnIds);

    const queue = pendingByAgentId.get(agentId) ?? [];
    const existing = queue.find(
      (item): item is { kind: "meeting-turn"; threadId: ContextId; meetingTurnIds: ContextId[] } =>
        item.kind === "meeting-turn" && item.threadId === meetingTurn.payload.threadId,
    );

    if (existing) {
      existing.meetingTurnIds.push(meetingTurn.id);
    } else {
      queue.push({ kind: "meeting-turn", threadId: meetingTurn.payload.threadId, meetingTurnIds: [meetingTurn.id] });
    }

    pendingByAgentId.set(agentId, queue);

    const latestStatus = store.latestAgentStatus(agentId);
    if (latestStatus?.payload.status !== "running") {
      void drainAgent(agentId);
    }
  }

  async function runTask(task: Task): Promise<void> {
    const worker = await resolveWorker(task.payload.assignedTo);
    if (!worker) return;

    const workerThreadId = resolveWorkerThreadId(task);

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
        type: "notification",
        payload: {
          kind: "agent-busy",
          targetAgentId: worker.agentId,
          taskId: task.id,
          threadId: workerThreadId,
          message: `agent ${worker.agentId} started task ${task.id}`,
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
        (context): context is Message =>
          context.type === "message" && context.payload.role === "assistant",
      );

      const isWaitingForReply = isTaskWaitingForReply(task, worker.agentId, workerThreadId);

      if (!isWaitingForReply) {
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

        store.append(
          createContextNode({
            id: createContextId(),
            type: "notification",
            payload: {
              kind: "task-completed",
              targetAgentId: worker.agentId,
              taskId: task.id,
              threadId: workerThreadId,
              message: `task ${task.id} completed`,
            },
          }),
        );
      }
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

      store.append(
        createContextNode({
          id: createContextId(),
          type: "notification",
          payload: {
            kind: "task-failed",
            targetAgentId: worker.agentId,
            taskId: task.id,
            threadId: workerThreadId,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    } finally {
      const isWaitingForReply = isTaskWaitingForReply(task, worker.agentId, workerThreadId);

      if (!isWaitingForReply) {
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

        store.append(
          createContextNode({
            id: createContextId(),
            type: "notification",
            payload: {
              kind: "agent-idle",
              targetAgentId: worker.agentId,
              taskId: task.id,
              threadId: workerThreadId,
              message: `agent ${worker.agentId} is idle`,
            },
          }),
        );
      }
    }
  }

  async function runNotificationReaction(agentId: ContextId, notificationIds: ContextId[]): Promise<void> {
    const reactiveAgent = reactiveAgentsById.get(agentId);
    if (!reactiveAgent) {
      return;
    }

    ensureOrchestrationThread();

    store.append(
      createContextNode({
        id: createContextId(),
        type: "agent-status",
        payload: {
          agentId,
          status: "running" as const,
          threadId: orchestrationThreadId,
        },
      }),
    );

    try {
      await reactiveAgent.agent.run({
        threadId: orchestrationThreadId,
        contexts: store.list(),
      });
    } finally {
      const pending = pendingNotificationIdsByAgentId.get(agentId);
      const delivered = deliveredNotificationIdsByAgentId.get(agentId) ?? new Set<ContextId>();
      for (const notificationId of notificationIds) {
        delivered.add(notificationId);
      }
      deliveredNotificationIdsByAgentId.set(agentId, delivered);

      if (pending) {
        for (const notificationId of notificationIds) {
          pending.delete(notificationId);
        }
        if (pending.size === 0) {
          pendingNotificationIdsByAgentId.delete(agentId);
        }
      }

      store.append(
        createContextNode({
          id: createContextId(),
          type: "agent-status",
          payload: {
            agentId,
            status: "idle" as const,
            threadId: orchestrationThreadId,
          },
        }),
      );
    }
  }

  async function runReplyReaction(agentId: ContextId, threadId: ContextId, replyRequestIds: ContextId[]): Promise<void> {
    const reactiveAgent = reactiveAgentsById.get(agentId);
    if (!reactiveAgent) {
      return;
    }

    store.append(
      createContextNode({
        id: createContextId(),
        type: "agent-status",
        payload: {
          agentId,
          status: "running" as const,
          threadId,
        },
      }),
    );

    try {
      await reactiveAgent.agent.run({
        threadId,
        contexts: store.list(),
      });
    } finally {
      const pending = pendingReplyRequestIdsByAgentId.get(agentId);
      const delivered = deliveredReplyRequestIdsByAgentId.get(agentId) ?? new Set<ContextId>();
      for (const replyRequestId of replyRequestIds) {
        delivered.add(replyRequestId);
      }
      deliveredReplyRequestIdsByAgentId.set(agentId, delivered);

      if (pending) {
        for (const replyRequestId of replyRequestIds) {
          pending.delete(replyRequestId);
        }
        if (pending.size === 0) {
          pendingReplyRequestIdsByAgentId.delete(agentId);
        }
      }

      for (const replyRequestId of replyRequestIds) {
        const replyRequest = store.get(replyRequestId);
        if (replyRequest?.type !== "reply-request" || !replyRequest.payload.requestedBy) {
          continue;
        }

        const requesterStatus = store.latestAgentStatus(replyRequest.payload.requestedBy);
        if (requesterStatus?.payload.status === "waiting") {
          store.appendMany([
            createContextNode({
              id: createContextId(),
              type: "agent-status",
              payload: {
                agentId: replyRequest.payload.requestedBy,
                status: "idle" as const,
                taskId: replyRequest.payload.taskId,
                threadId: replyRequest.payload.threadId,
              },
            }),
            createContextNode({
              id: createContextId(),
              type: "notification",
              payload: {
                kind: "reply-available",
                targetAgentId: replyRequest.payload.requestedBy,
                taskId: replyRequest.payload.taskId,
                threadId: replyRequest.payload.threadId,
                message: `reply available for ${replyRequest.payload.requestedBy}`,
              },
            }),
          ]);
        }

        if (replyRequest.payload.taskId) {
          const task = store.get(replyRequest.payload.taskId);
          if (task?.type === "task") {
            enqueueWork(task.payload.assignedTo, { kind: "task", task, resume: true });
          }
        }
      }

      store.append(
        createContextNode({
          id: createContextId(),
          type: "agent-status",
          payload: {
            agentId,
            status: "idle" as const,
            threadId,
          },
        }),
      );
    }
  }

  async function runMeetingTurn(agentId: ContextId, threadId: ContextId, meetingTurnIds: ContextId[]): Promise<void> {
    const reactiveAgent = reactiveAgentsById.get(agentId);
    const worker = reactiveAgent ? undefined : await resolveWorker(agentId);
    const participantAgent = reactiveAgent?.agent ?? worker?.agent;
    if (!participantAgent) {
      return;
    }

    store.append(
      createContextNode({
        id: createContextId(),
        type: "agent-status",
        payload: {
          agentId,
          status: "running" as const,
          threadId,
        },
      }),
    );

    try {
      await participantAgent.run({
        threadId,
        contexts: store.list(),
      });
    } finally {
      const pending = pendingMeetingTurnIdsByAgentId.get(agentId);
      const delivered = deliveredMeetingTurnIdsByAgentId.get(agentId) ?? new Set<ContextId>();
      for (const meetingTurnId of meetingTurnIds) {
        delivered.add(meetingTurnId);
      }
      deliveredMeetingTurnIdsByAgentId.set(agentId, delivered);

      if (pending) {
        for (const meetingTurnId of meetingTurnIds) {
          pending.delete(meetingTurnId);
        }
        if (pending.size === 0) {
          pendingMeetingTurnIdsByAgentId.delete(agentId);
        }
      }

      store.append(
        createContextNode({
          id: createContextId(),
          type: "agent-status",
          payload: {
            agentId,
            status: "idle" as const,
            threadId,
          },
        }),
      );
    }
  }

  function drainAgent(agentId: ContextId): Promise<void> {
    const existing = drainPromisesByAgentId.get(agentId);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      runningAgentIds.add(agentId);
      try {
        while (true) {
          const queue = pendingByAgentId.get(agentId);
          const work = queue?.shift();

          if (!work) {
            pendingByAgentId.delete(agentId);
            break;
          }

          if (queue && queue.length === 0) {
            pendingByAgentId.delete(agentId);
          }

          if (work.kind === "task") {
            await runTask(work.task);
            enqueuedTaskIds.delete(work.task.id);
            continue;
          }

          if (work.kind === "reply") {
            await runReplyReaction(agentId, work.threadId, work.replyRequestIds);
            continue;
          }

          if (work.kind === "meeting-turn") {
            await runMeetingTurn(agentId, work.threadId, work.meetingTurnIds);
            continue;
          }

          await runNotificationReaction(agentId, work.notificationIds);
        }
      } finally {
        runningAgentIds.delete(agentId);
        drainPromisesByAgentId.delete(agentId);
      }
    })();

    drainPromisesByAgentId.set(agentId, promise);
    return promise;
  }

  function enqueueTask(task: Task): void {
    const currentStatus = store.latestTaskStatus(task.id);
    if (currentStatus && currentStatus.payload.status !== "pending") {
      return;
    }
    if (enqueuedTaskIds.has(task.id)) {
      return;
    }
    enqueuedTaskIds.add(task.id);
    enqueueWork(task.payload.assignedTo, { kind: "task", task });
  }

  return {
    start() {
      return store.subscribe((context) => {
        if (context.type === "task") {
          if (workersByAgentId.has(context.payload.assignedTo) || agentFactory) {
            enqueueTask(context);
          }
          return;
        }

        if (context.type === "notification") {
          enqueueNotificationReaction(context);
          return;
        }

        if (context.type === "reply-request") {
          enqueueReplyReaction(context);
          return;
        }

        if (context.type === "meeting-turn") {
          enqueueMeetingTurn(context);
          return;
        }

        if (
          context.type === "agent-status" &&
          context.payload.status === "idle" &&
          pendingByAgentId.has(context.payload.agentId)
        ) {
          const existingDrain = drainPromisesByAgentId.get(context.payload.agentId);
          if (existingDrain) {
            void existingDrain.finally(() => {
              if (pendingByAgentId.has(context.payload.agentId)) {
                void drainAgent(context.payload.agentId);
              }
            });
          } else {
            void drainAgent(context.payload.agentId);
          }
        }
      });
    },

    async tick() {
      const seenTaskIds = new Set<ContextId>();
      const allTasks: Task[] = [];

      for (const worker of workersByAgentId.values()) {
        for (const task of store.listPendingTasks(worker.agentId)) {
          if (seenTaskIds.has(task.id)) continue;
          seenTaskIds.add(task.id);
          allTasks.push(task);
        }
      }

      if (agentFactory) {
        const storeTasks = store.list().filter((context): context is Task => {
          if (context.type !== "task") return false;
          const status = store.latestTaskStatus(context.id);
          return !status || status.payload.status === "pending";
        });

        for (const task of storeTasks) {
          if (seenTaskIds.has(task.id)) continue;
          seenTaskIds.add(task.id);
          allTasks.push(task);
        }
      }

      for (const task of allTasks) {
        enqueueTask(task);
      }

      for (const notification of store.listNotifications()) {
        enqueueNotificationReaction(notification);
      }

      for (const agent of store.listAgents()) {
        for (const replyRequest of store.listPendingReplyRequests(agent.id)) {
          enqueueReplyReaction(replyRequest);
        }
        for (const meetingTurn of store.listPendingMeetingTurns(agent.id)) {
          enqueueMeetingTurn(meetingTurn);
        }
      }

      await Promise.all(drainPromisesByAgentId.values());
    },

    waitForTask(taskId) {
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
