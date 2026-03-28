import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createContextId,
  createContextNode,
  type Agent,
  type ContextStore,
  type ContextId,
} from "@termy/core";

export type ReplInput = {
  store: ContextStore;
  threadId: ContextId;
  userId: ContextId;
  managerId: ContextId;
  managerAgent: Agent;
  sessionPath: string;
  sessionId: string;
};

export async function runCliRepl(inputData: ReplInput): Promise<void> {
  const { store, threadId, userId, managerId, managerAgent, sessionPath, sessionId } = inputData;
  const rl = readline.createInterface({ input, output });

  console.log(`termy ready. session: ${sessionPath}. type 'exit' to quit.`);
  console.log(`[cli] session: ${sessionId}`);

  try {
    while (true) {
      const line = (await rl.question("> ")).trim();

      if (!line) {
        continue;
      }

      if (line === "exit") {
        console.log("bye");
        break;
      }

      const previousMessage = store.latestMessage(threadId);
      const userMessage = createContextNode({
        id: createContextId(),
        type: "message",
        createdBy: userId,
        payload: {
          role: "user" as const,
          text: line,
          threadId,
          previousMessageId: previousMessage?.id,
        },
      });
      store.append(userMessage);

      store.append(
        createContextNode({
          id: createContextId(),
          type: "agent-status",
          payload: {
            agentId: managerId,
            status: "running" as const,
            threadId,
          },
        }),
      );

      const result = await (async () => {
        try {
          return await managerAgent.run({
            threadId,
            contexts: store.list(),
            hooks: {
              onTextDelta(delta) {
                void delta;
              },
            },
          });
        } finally {
          store.append(
            createContextNode({
              id: createContextId(),
              type: "agent-status",
              payload: {
                agentId: managerId,
                status: "idle" as const,
                threadId,
              },
            }),
          );
        }
      })();

      const assistantMsg = result.contexts.find(
        (c) => c.type === "message" && c.payload.role === "assistant",
      );

      if (assistantMsg && assistantMsg.type === "message") {
        console.log(assistantMsg.payload.text);
      }

      console.log(`[cli] thread contexts: ${store.listThread(threadId).length}`);
      console.log(`[cli] total contexts: ${store.list().length}`);
      console.log(`[cli] persisted to ${sessionPath}`);
    }
  } finally {
    rl.close();
  }
}
