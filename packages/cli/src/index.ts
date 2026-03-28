#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  createAgent,
  createContextId,
  createContextNode,
  createContextStore,
  createExecutionEngine,
  createJsonlContextJournal,
  ensureAgentContext,
  ensureThreadContext,
  ensureUserContext,
  managerProjection,
  workerProjection,
  type ContextStore,
  type ExecutionEngine,
} from "@termy/core";

import { createPiSdkRuntime } from "./pi-sdk-runtime.js";
import { MANAGER_SYSTEM_PROMPT } from "./termy-runtime-config.js";

function createTaskTool(
  store: ContextStore,
  engine: ExecutionEngine,
  managerId: string,
  threadId: string,
): ToolDefinition {
  return {
    name: "create_task",
    label: "Create Task",
    description: "Delegate work to a worker agent. Use this when you need file operations, code changes, research, or investigation. The worker has access to tools like read, write, edit, bash, grep, find, and ls.",
    promptSnippet: "create_task: Delegate work to a worker agent",
    parameters: Type.Object({
      instruction: Type.String({ description: "Clear instruction for the worker" }),
      title: Type.Optional(Type.String({ description: "Short title for the task" })),
      agentRole: Type.Optional(Type.String({ description: "Role of the agent to assign (e.g. 'reader', 'researcher'). If not found, a new agent is created." })),
    }),
    async execute(toolCallId, params: { instruction: string; title?: string; agentRole?: string }) {
      // Resolve target agent: by role or default worker
      const role = params.agentRole ?? "worker";
      let targetAgent = store.findAgentByRole(role);

      if (!targetAgent) {
        // Spawn a new agent by appending AgentContext to store
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

      const taskId = createContextId();
      store.append(
        createContextNode({
          id: taskId,
          type: "task",
          createdBy: managerId,
          payload: {
            parentThreadId: threadId,
            assignedTo: targetAgent.id,
            instruction: params.instruction,
            title: params.title,
          },
        }),
      );

      await engine.waitForTask(taskId);

      const results = store.listTaskResults(taskId);
      const status = store.latestTaskStatus(taskId);
      const workerOutput = results.length > 0 ? String(results[0].payload.output) : "(no result)";

      return {
        content: [
          {
            type: "text" as const,
            text: `Task ${status?.payload.status ?? "unknown"}: ${workerOutput}`,
          },
        ],
        details: { taskId },
      };
    },
  };
}

async function main(): Promise<void> {
  console.log("[cli] booting @termy/cli");

  const sessionId = createContextId();
  const sessionPath = join(process.cwd(), ".termy", "sessions", `${sessionId}.jsonl`);
  mkdirSync(dirname(sessionPath), { recursive: true });

  const journal = createJsonlContextJournal(sessionPath);
  const store = createContextStore([], { journal });

  const thread = ensureThreadContext({
    store,
    key: "main",
    name: "main",
  });
  const user = ensureUserContext({
    store,
    key: "cli",
    name: "cli",
  });
  const manager = ensureAgentContext({
    store,
    key: "manager",
    name: "manager",
    role: "manager",
  });
  const worker = ensureAgentContext({
    store,
    key: "worker:reader",
    name: "reader",
    role: "worker",
  });

  const workerRuntime = await createPiSdkRuntime();

  const engine = createExecutionEngine({
    store,
    workers: [
      {
        agentId: worker.id,
        agent: createAgent({
          id: worker.id,
          store,
          runtime: workerRuntime,
          projection: workerProjection(),
        }),
      },
    ],
    agentFactory: async (agentId, agentStore) => {
      const runtime = await createPiSdkRuntime();
      return createAgent({
        id: agentId,
        store: agentStore,
        runtime,
        projection: workerProjection(),
      });
    },
  });

  const stopEngine = engine.start();

  const createTaskToolDef = createTaskTool(store, engine, manager.id, thread.id);
  const managerRuntime = await createPiSdkRuntime({
    systemPrompt: MANAGER_SYSTEM_PROMPT,
    customTools: [createTaskToolDef],
  });

  const managerAgent = createAgent({
    id: manager.id,
    store,
    runtime: managerRuntime,
    projection: managerProjection(MANAGER_SYSTEM_PROMPT),
  });

  const rl = readline.createInterface({ input, output });

  console.log(`termy ready. session: ${sessionPath}. type 'exit' to quit.`);
  console.log(`[cli] session: ${sessionId}`);

  while (true) {
    const line = (await rl.question("> ")).trim();

    if (!line) {
      continue;
    }

    if (line === "exit") {
      console.log("bye");
      break;
    }

    // Create user message (previously done by Conversation)
    const previousMessage = store.latestMessage(thread.id);
    const userMessage = createContextNode({
      id: createContextId(),
      type: "message",
      createdBy: user.id,
      payload: {
        role: "user" as const,
        text: line,
        threadId: thread.id,
        previousMessageId: previousMessage?.id,
      },
    });
    store.append(userMessage);

    const result = await managerAgent.run({
      threadId: thread.id,
      contexts: store.list(),
      hooks: {
        onTextDelta(delta) {
          void delta;
        },
      },
    });

    const assistantMsg = result.contexts.find(
      (c) => c.type === "message" && c.payload.role === "assistant",
    );

    if (assistantMsg && assistantMsg.type === "message") {
      console.log(assistantMsg.payload.text);
    }

    console.log(`[cli] thread contexts: ${store.listThread(thread.id).length}`);
    console.log(`[cli] total contexts: ${store.list().length}`);
    console.log(`[cli] persisted to ${sessionPath}`);
  }

  stopEngine();
  rl.close();
}

main().catch((error: unknown) => {
  console.error("[cli] fatal error", error);
  process.exit(1);
});
