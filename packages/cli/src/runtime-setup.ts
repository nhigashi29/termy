import {
  createAgent,
  createExecutionEngine,
  managerProjection,
  orchestrationProjection,
  workerProjection,
  type Agent,
  type ContextStore,
  type ExecutionEngine,
} from "@termy/core";

import { createPiSdkRuntime } from "./pi-sdk-runtime.js";
import {
  createCloseMeetingTool,
  createMeetingTool,
  createRequestClarificationTool,
  createRequestMeetingTurnTool,
} from "./tool-definitions/coordination-tools.js";
import {
  createTaskTool,
  getTaskResultsTool,
  waitForTasksTool,
} from "./tool-definitions/task-tools.js";
import { MANAGER_SYSTEM_PROMPT, WORKER_SYSTEM_PROMPT } from "./termy-runtime-config.js";
import {
  getMeetingResultsTool,
  getThreadTaskResultsTool,
  postThreadMessageTool,
} from "./tool-definitions/promotion-tools.js";

export type RuntimeSetupInput = {
  store: ContextStore;
  threadId: string;
  managerId: string;
  workerId: string;
};

export type RuntimeSetup = {
  managerAgent: Agent;
  engine: ExecutionEngine;
};

export async function setupCliRuntime(input: RuntimeSetupInput): Promise<RuntimeSetup> {
  const { store, threadId, managerId, workerId } = input;

  const createWorkerRuntime = (agentId: string, targetStore: ContextStore) =>
    createPiSdkRuntime({
      systemPrompt: WORKER_SYSTEM_PROMPT,
      customTools: [createRequestClarificationTool(targetStore, agentId)],
    });

  const workerRuntime = await createWorkerRuntime(workerId, store);

  let engine!: ExecutionEngine;

  const managerRuntime = await createPiSdkRuntime({
    systemPrompt: MANAGER_SYSTEM_PROMPT,
    customTools: [
      createTaskTool(store, managerId, threadId),
      createMeetingTool(store, managerId),
      createRequestMeetingTurnTool(store, managerId),
      createCloseMeetingTool(store, managerId),
      waitForTasksTool(store, engine),
      getTaskResultsTool(store),
      getThreadTaskResultsTool(store),
      getMeetingResultsTool(store),
      postThreadMessageTool(store, managerId),
    ],
  });

  const managerAgent = createAgent({
    id: managerId,
    store,
    runtime: managerRuntime,
    projection: managerProjection(MANAGER_SYSTEM_PROMPT),
  });

  const managerReactiveAgent = createAgent({
    id: managerId,
    store,
    runtime: managerRuntime,
    projection: orchestrationProjection(MANAGER_SYSTEM_PROMPT),
  });

  engine = createExecutionEngine({
    store,
    workers: [
      {
        agentId: workerId,
        agent: createAgent({
          id: workerId,
          store,
          runtime: workerRuntime,
          projection: workerProjection(WORKER_SYSTEM_PROMPT),
        }),
      },
    ],
    reactiveAgents: [
      {
        agentId: managerId,
        agent: managerReactiveAgent,
      },
    ],
    subscriptions: [
      {
        subscriberAgentId: managerId,
        kinds: ["task-completed", "task-failed"],
      },
    ],
    agentFactory: async (agentId, agentStore) => {
      const runtime = await createWorkerRuntime(agentId, agentStore);
      return createAgent({
        id: agentId,
        store: agentStore,
        runtime,
        projection: workerProjection(WORKER_SYSTEM_PROMPT),
      });
    },
  });

  return {
    managerAgent,
    engine,
  };
}
