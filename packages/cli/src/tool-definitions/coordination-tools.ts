import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  closeMeetingCommand,
  createMeetingCommand,
  requestClarificationCommand,
  requestMeetingTurnCommand,
  type ContextStore,
} from "@termy/core";

export function createRequestClarificationTool(
  store: ContextStore,
  agentId: string,
): ToolDefinition {
  return {
    name: "request_clarification",
    label: "Request Clarification",
    description: "Ask another agent, usually the manager, for clarification about the current task thread.",
    promptSnippet: "request_clarification: Ask for a specific clarification question when blocked",
    parameters: Type.Object({
      question: Type.String({ description: "Specific clarification question" }),
      targetAgentRole: Type.Optional(Type.String({ description: "Target agent role. Defaults to 'manager'." })),
    }),
    async execute(toolCallId, params: { question: string; targetAgentRole?: string }) {
      void toolCallId;
      const result = requestClarificationCommand({
        store,
        agentId,
        question: params.question,
        targetAgentRole: params.targetAgentRole,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Clarification requested from ${result.requestedAgentName}: ${params.question}`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createMeetingTool(
  store: ContextStore,
  managerId: string,
): ToolDefinition {
  return {
    name: "create_meeting",
    label: "Create Meeting",
    description: "Create a meeting thread with participants and an initial open meeting state.",
    promptSnippet: "create_meeting: Create a shared meeting thread for multi-agent deliberation",
    parameters: Type.Object({
      title: Type.String({ description: "Meeting title" }),
      objective: Type.String({ description: "Meeting objective or agenda" }),
      participantRoles: Type.Array(Type.String({ description: "Participant role, e.g. reviewer, researcher" })),
      turnPolicy: Type.Optional(Type.Union([
        Type.Literal("manager-mediated"),
        Type.Literal("free"),
        Type.Literal("round-robin"),
      ])),
    }),
    async execute(toolCallId, params: {
      title: string;
      objective: string;
      participantRoles: string[];
      turnPolicy?: "manager-mediated" | "free" | "round-robin";
    }) {
      void toolCallId;
      const result = createMeetingCommand({
        store,
        managerId,
        title: params.title,
        objective: params.objective,
        participantRoles: params.participantRoles,
        turnPolicy: params.turnPolicy,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Meeting created: ${result.threadId} with participants ${result.participantNames.join(", ")}`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createRequestMeetingTurnTool(
  store: ContextStore,
  managerId: string,
): ToolDefinition {
  return {
    name: "request_meeting_turn",
    label: "Request Meeting Turn",
    description: "Request that a participant contribute to a meeting thread.",
    promptSnippet: "request_meeting_turn: Ask a participant to speak in a meeting thread",
    parameters: Type.Object({
      threadId: Type.String({ description: "Meeting thread id" }),
      participantRole: Type.String({ description: "Target participant role" }),
      agenda: Type.String({ description: "What the participant should address" }),
      taskId: Type.Optional(Type.String({ description: "Optional related task id" })),
    }),
    async execute(toolCallId, params: {
      threadId: string;
      participantRole: string;
      agenda: string;
      taskId?: string;
    }) {
      void toolCallId;
      const result = requestMeetingTurnCommand({
        store,
        managerId,
        threadId: params.threadId,
        participantRole: params.participantRole,
        agenda: params.agenda,
        taskId: params.taskId,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Meeting turn requested from ${result.requestedAgentName} in ${result.threadId}`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createCloseMeetingTool(
  store: ContextStore,
  managerId: string,
): ToolDefinition {
  return {
    name: "close_meeting",
    label: "Close Meeting",
    description: "Close a meeting thread and optionally append a summary message.",
    promptSnippet: "close_meeting: Close a meeting and record a summary",
    parameters: Type.Object({
      threadId: Type.String({ description: "Meeting thread id" }),
      summary: Type.Optional(Type.String({ description: "Optional closing summary" })),
    }),
    async execute(toolCallId, params: { threadId: string; summary?: string }) {
      void toolCallId;
      const result = closeMeetingCommand({
        store,
        managerId,
        threadId: params.threadId,
        summary: params.summary,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Meeting closed: ${result.threadId}`,
          },
        ],
        details: result,
      };
    },
  };
}
