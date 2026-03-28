import { createContextId } from "./context-identity.js";
import { createContextNode } from "./context.js";
import type { ContextStore } from "./context-store.js";
import type { AnyContext, ContextId, ThreadTurnPolicy } from "./context-types.js";
import type { ExecutionEngine } from "./execution-engine.js";

function resolveOrCreateAgent(store: ContextStore, role: string) {
  let targetAgent = store.findAgentByRole(role);

  if (!targetAgent) {
    targetAgent = createContextNode({
      id: createContextId(),
      type: "agent",
      payload: {
        key: `worker:${role}`,
        name: role,
        role,
      },
    });
    store.append(targetAgent);
  }

  return targetAgent;
}

export type CreateTaskCommandInput = {
  store: ContextStore;
  managerId: ContextId;
  threadId: ContextId;
  instruction: string;
  title?: string;
  agentRole?: string;
};

export function createTaskCommand(input: CreateTaskCommandInput) {
  const role = input.agentRole ?? "worker";
  const targetAgent = resolveOrCreateAgent(input.store, role);

  const taskId = createContextId();
  const workerThreadId = createContextId();

  input.store.appendMany([
    createContextNode({
      id: workerThreadId,
      type: "thread",
      createdBy: input.managerId,
      payload: {
        key: `task:${taskId}`,
        name: `task:${taskId}`,
      },
    }),
    createContextNode({
      id: taskId,
      type: "task",
      createdBy: input.managerId,
      payload: {
        parentThreadId: input.threadId,
        workerThreadId,
        assignedTo: targetAgent.id,
        instruction: input.instruction,
        title: input.title,
      },
    }),
  ]);

  return {
    taskId,
    assignedTo: targetAgent.id,
    assignedAgentName: targetAgent.payload.name ?? targetAgent.id,
    workerThreadId,
  };
}

export type WaitForTasksCommandInput = {
  store: ContextStore;
  engine: ExecutionEngine;
  taskIds: ContextId[];
};

export async function waitForTasksCommand(input: WaitForTasksCommandInput) {
  await Promise.all(input.taskIds.map((taskId) => input.engine.waitForTask(taskId)));
  return getTaskResultsCommand({ store: input.store, taskIds: input.taskIds });
}

export type RequestClarificationCommandInput = {
  store: ContextStore;
  agentId: ContextId;
  question: string;
  targetAgentRole?: string;
};

export function requestClarificationCommand(input: RequestClarificationCommandInput) {
  const currentStatus = input.store.latestAgentStatus(input.agentId);
  if (!currentStatus?.payload.threadId) {
    throw new Error(`agent ${input.agentId} has no active thread for clarification`);
  }

  const targetRole = input.targetAgentRole ?? "manager";
  const targetAgent = input.store.findAgentByRole(targetRole);
  if (!targetAgent) {
    throw new Error(`no agent found for role: ${targetRole}`);
  }

  const replyRequestId = createContextId();
  input.store.appendMany([
    createContextNode({
      id: createContextId(),
      type: "agent-status",
      payload: {
        agentId: input.agentId,
        status: "waiting" as const,
        taskId: currentStatus.payload.taskId,
        threadId: currentStatus.payload.threadId,
      },
    }),
    createContextNode({
      id: replyRequestId,
      type: "reply-request",
      createdBy: input.agentId,
      payload: {
        threadId: currentStatus.payload.threadId,
        requestedFrom: targetAgent.id,
        requestedBy: input.agentId,
        taskId: currentStatus.payload.taskId,
        message: input.question,
      },
    }),
    createContextNode({
      id: createContextId(),
      type: "notification",
      createdBy: input.agentId,
      payload: {
        kind: "clarification-requested",
        targetAgentId: targetAgent.id,
        taskId: currentStatus.payload.taskId,
        threadId: currentStatus.payload.threadId,
        message: input.question,
      },
    }),
  ]);

  return {
    replyRequestId,
    requestedFrom: targetAgent.id,
    requestedAgentName: targetAgent.payload.name ?? targetAgent.id,
    threadId: currentStatus.payload.threadId,
    taskId: currentStatus.payload.taskId,
  };
}

export type CreateMeetingCommandInput = {
  store: ContextStore;
  managerId: ContextId;
  title: string;
  objective: string;
  participantRoles: string[];
  turnPolicy?: ThreadTurnPolicy;
};

export function createMeetingCommand(input: CreateMeetingCommandInput) {
  const participants = input.participantRoles.map((role) => resolveOrCreateAgent(input.store, role));
  const threadId = createContextId();
  const participantIds = [input.managerId, ...participants.map((participant) => participant.id)];
  const turnPolicy = input.turnPolicy ?? "manager-mediated";

  input.store.appendMany([
    createContextNode({
      id: threadId,
      type: "thread",
      createdBy: input.managerId,
      payload: {
        key: `meeting:${threadId}`,
        name: input.title,
        mode: "meeting" as const,
        participantIds,
        turnPolicy,
      },
    }),
    createContextNode({
      id: createContextId(),
      type: "meeting-state",
      createdBy: input.managerId,
      payload: {
        threadId,
        status: "open" as const,
        facilitatorId: input.managerId,
        objective: input.objective,
      },
    }),
    createContextNode({
      id: createContextId(),
      type: "message",
      createdBy: input.managerId,
      payload: {
        role: "assistant" as const,
        text: `Facilitator opening: ${input.title}. Objective: ${input.objective}`,
        threadId,
      },
    }),
  ]);

  return {
    threadId,
    participantIds,
    participantNames: participants.map((participant) => participant.payload.name ?? participant.id),
    turnPolicy,
  };
}

export type RequestMeetingTurnCommandInput = {
  store: ContextStore;
  managerId: ContextId;
  threadId: ContextId;
  participantRole: string;
  agenda: string;
  taskId?: ContextId;
};

export function requestMeetingTurnCommand(input: RequestMeetingTurnCommandInput) {
  const meetingThread = input.store.get(input.threadId);
  if (meetingThread?.type !== "thread" || meetingThread.payload.mode !== "meeting") {
    throw new Error(`thread is not a meeting: ${input.threadId}`);
  }

  const participant = resolveOrCreateAgent(input.store, input.participantRole);
  input.store.append(
    createContextNode({
      id: createContextId(),
      type: "meeting-turn",
      createdBy: input.managerId,
      payload: {
        threadId: input.threadId,
        requestedFrom: participant.id,
        requestedBy: input.managerId,
        taskId: input.taskId,
        agenda: input.agenda,
      },
    }),
  );

  return {
    threadId: input.threadId,
    requestedFrom: participant.id,
    requestedAgentName: participant.payload.name ?? participant.id,
    agenda: input.agenda,
  };
}

export type CloseMeetingCommandInput = {
  store: ContextStore;
  managerId: ContextId;
  threadId: ContextId;
  summary?: string;
};

export function closeMeetingCommand(input: CloseMeetingCommandInput) {
  const meetingThread = input.store.get(input.threadId);
  if (meetingThread?.type !== "thread" || meetingThread.payload.mode !== "meeting") {
    throw new Error(`thread is not a meeting: ${input.threadId}`);
  }

  const contexts: import("./context-types.js").AnyContext[] = [
    createContextNode({
      id: createContextId(),
      type: "meeting-state",
      createdBy: input.managerId,
      payload: {
        threadId: input.threadId,
        status: "closed" as const,
        facilitatorId: input.managerId,
        objective: input.summary,
      },
    }),
  ];

  if (input.summary) {
    contexts.push(
      createContextNode({
        id: createContextId(),
        type: "message",
        createdBy: input.managerId,
        payload: {
          role: "assistant" as const,
          text: input.summary,
          threadId: input.threadId,
        },
      }),
    );
  }

  input.store.appendMany(contexts);

  return {
    threadId: input.threadId,
    summary: input.summary,
  };
}

export type GetTaskResultsCommandInput = {
  store: ContextStore;
  taskIds: ContextId[];
};

export function getTaskResultsCommand(input: GetTaskResultsCommandInput) {
  const tasks = input.taskIds.map((taskId) => {
    const status = input.store.latestTaskStatus(taskId);
    const result = input.store.listTaskResults(taskId)[0];
    return {
      taskId,
      status: status?.payload.status ?? "pending",
      output: result?.payload.output,
      reason: status?.payload.reason,
    };
  });

  return { tasks };
}

export type CollectThreadTaskResultsCommandInput = {
  store: ContextStore;
  threadId: ContextId;
};

export function collectThreadTaskResultsCommand(input: CollectThreadTaskResultsCommandInput) {
  const tasks = input.store
    .list()
    .filter((context): context is Extract<AnyContext, { type: "task" }> => {
      return context.type === "task" && context.payload.parentThreadId === input.threadId;
    })
    .map((task) => {
      const status = input.store.latestTaskStatus(task.id);
      const result = input.store.listTaskResults(task.id)[0];
      return {
        taskId: task.id,
        title: task.payload.title,
        instruction: task.payload.instruction,
        assignedTo: task.payload.assignedTo,
        workerThreadId: task.payload.workerThreadId,
        status: status?.payload.status ?? "pending",
        output: result?.payload.output,
        reason: status?.payload.reason,
      };
    });

  return {
    threadId: input.threadId,
    tasks,
    counts: {
      total: tasks.length,
      pending: tasks.filter((task) => task.status === "pending").length,
      inProgress: tasks.filter((task) => task.status === "in-progress").length,
      done: tasks.filter((task) => task.status === "done").length,
      failed: tasks.filter((task) => task.status === "failed").length,
    },
  };
}

export type GetMeetingResultsCommandInput = {
  store: ContextStore;
  threadId: ContextId;
};

export function getMeetingResultsCommand(input: GetMeetingResultsCommandInput) {
  const meetingThread = input.store.get(input.threadId);
  if (meetingThread?.type !== "thread" || meetingThread.payload.mode !== "meeting") {
    throw new Error(`thread is not a meeting: ${input.threadId}`);
  }

  const threadContexts = input.store.listThread(input.threadId);
  const participantIds = meetingThread.payload.participantIds ?? [];
  const meetingTurns = threadContexts.filter(
    (context): context is Extract<AnyContext, { type: "meeting-turn" }> => context.type === "meeting-turn",
  );
  const messages = threadContexts.filter(
    (context): context is Extract<AnyContext, { type: "message" }> => context.type === "message",
  );

  const respondedByAgentId = new Set(
    messages
      .map((message) => message.createdBy)
      .filter((createdBy): createdBy is ContextId => Boolean(createdBy)),
  );

  const requestedParticipantIds = Array.from(new Set(meetingTurns.map((turn) => turn.payload.requestedFrom)));
  const pendingParticipantIds = Array.from(
    new Set(
      meetingTurns
        .filter((turn) => {
          return !messages.some((message) => {
            return (
              message.createdBy === turn.payload.requestedFrom &&
              message.payload.threadId === input.threadId &&
              message.createdAt >= turn.createdAt
            );
          });
        })
        .map((turn) => turn.payload.requestedFrom),
    ),
  );

  return {
    threadId: input.threadId,
    participantIds,
    requestedParticipantIds,
    respondedParticipantIds: Array.from(respondedByAgentId),
    pendingParticipantIds,
    isComplete: pendingParticipantIds.length === 0 && requestedParticipantIds.length > 0,
    messages: messages.map((message) => ({
      id: message.id,
      createdBy: message.createdBy,
      role: message.payload.role,
      text: message.payload.text,
    })),
  };
}

export type PostThreadMessageCommandInput = {
  store: ContextStore;
  authorId: ContextId;
  threadId: ContextId;
  text: string;
  role?: "assistant" | "system" | "user";
};

export function postThreadMessageCommand(input: PostThreadMessageCommandInput) {
  const thread = input.store.get(input.threadId);
  if (thread?.type !== "thread") {
    throw new Error(`thread not found: ${input.threadId}`);
  }

  const previousMessage = input.store.latestMessage(input.threadId);
  const message = createContextNode({
    id: createContextId(),
    type: "message",
    createdBy: input.authorId,
    payload: {
      role: input.role ?? "assistant",
      text: input.text,
      threadId: input.threadId,
      previousMessageId: previousMessage?.id,
    },
  });

  input.store.append(message);

  return {
    threadId: input.threadId,
    messageId: message.id,
    text: input.text,
  };
}
