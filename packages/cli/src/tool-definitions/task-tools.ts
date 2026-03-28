import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  createTaskCommand,
  getTaskResultsCommand,
  waitForTasksCommand,
  type ContextStore,
  type ExecutionEngine,
} from "@termy/core";

export function createTaskTool(
  store: ContextStore,
  managerId: string,
  threadId: string,
): ToolDefinition {
  return {
    name: "create_task",
    label: "Create Task",
    description: "Create an asynchronous task for a worker agent. Use this for delegation and fan-out. Returns immediately with a task id.",
    promptSnippet: "create_task: Create an async task for a worker agent",
    parameters: Type.Object({
      instruction: Type.String({ description: "Clear instruction for the worker" }),
      title: Type.Optional(Type.String({ description: "Short title for the task" })),
      agentRole: Type.Optional(Type.String({ description: "Role of the agent to assign (e.g. 'reader', 'researcher'). If not found, a new agent is created." })),
    }),
    async execute(toolCallId, params: { instruction: string; title?: string; agentRole?: string }) {
      void toolCallId;
      const result = createTaskCommand({
        store,
        managerId,
        threadId,
        instruction: params.instruction,
        title: params.title,
        agentRole: params.agentRole,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Task created: ${result.taskId} -> ${result.assignedAgentName}`,
          },
        ],
        details: result,
      };
    },
  };
}

export function waitForTasksTool(
  store: ContextStore,
  engine: ExecutionEngine,
): ToolDefinition {
  return {
    name: "wait_for_tasks",
    label: "Wait For Tasks",
    description: "Wait for one or more previously-created tasks to complete and return their statuses/results.",
    promptSnippet: "wait_for_tasks: Wait for async tasks to complete",
    parameters: Type.Object({
      taskIds: Type.Array(Type.String({ description: "Task id to wait for" })),
    }),
    async execute(toolCallId, params: { taskIds: string[] }) {
      void toolCallId;
      const result = await waitForTasksCommand({ store, engine, taskIds: params.taskIds });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        details: result,
      };
    },
  };
}

export function getTaskResultsTool(store: ContextStore): ToolDefinition {
  return {
    name: "get_task_results",
    label: "Get Task Results",
    description: "Fetch current statuses and any available results for tasks without waiting.",
    promptSnippet: "get_task_results: Inspect async task state without blocking",
    parameters: Type.Object({
      taskIds: Type.Array(Type.String({ description: "Task id to inspect" })),
    }),
    async execute(toolCallId, params: { taskIds: string[] }) {
      void toolCallId;
      const result = getTaskResultsCommand({ store, taskIds: params.taskIds });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        details: result,
      };
    },
  };
}
