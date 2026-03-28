import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  collectThreadTaskResultsCommand,
  getMeetingResultsCommand,
  postThreadMessageCommand,
  type ContextStore,
} from "@termy/core";

export function getThreadTaskResultsTool(store: ContextStore): ToolDefinition {
  return {
    name: "get_thread_task_results",
    label: "Get Thread Task Results",
    description: "Collect the statuses and available results of tasks created from a parent thread. Use this to fan in worker outcomes.",
    promptSnippet: "get_thread_task_results: Collect sibling task statuses/results for a parent thread",
    parameters: Type.Object({
      threadId: Type.String({ description: "Parent thread id" }),
    }),
    async execute(toolCallId, params: { threadId: string }) {
      void toolCallId;
      const result = collectThreadTaskResultsCommand({ store, threadId: params.threadId });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}

export function getMeetingResultsTool(store: ContextStore): ToolDefinition {
  return {
    name: "get_meeting_results",
    label: "Get Meeting Results",
    description: "Collect participant responses and pending turns for a meeting thread.",
    promptSnippet: "get_meeting_results: Collect meeting contributions and pending participants",
    parameters: Type.Object({
      threadId: Type.String({ description: "Meeting thread id" }),
    }),
    async execute(toolCallId, params: { threadId: string }) {
      void toolCallId;
      const result = getMeetingResultsCommand({ store, threadId: params.threadId });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}

export function postThreadMessageTool(
  store: ContextStore,
  authorId: string,
): ToolDefinition {
  return {
    name: "post_thread_message",
    label: "Post Thread Message",
    description: "Post a concise assistant message into a target thread. Use this to promote collected results into a user-facing thread.",
    promptSnippet: "post_thread_message: Promote a concise summary into a target thread",
    parameters: Type.Object({
      threadId: Type.String({ description: "Target thread id" }),
      text: Type.String({ description: "Message text to append" }),
    }),
    async execute(toolCallId, params: { threadId: string; text: string }) {
      void toolCallId;
      const result = postThreadMessageCommand({
        store,
        authorId,
        threadId: params.threadId,
        text: params.text,
        role: "assistant",
      });

      return {
        content: [{ type: "text" as const, text: `Posted message to ${result.threadId}` }],
        details: result,
      };
    },
  };
}
