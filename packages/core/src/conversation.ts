import { randomUUID } from "node:crypto";

import { createContextNode } from "./context.js";
import type { ContextJournal } from "./context-journal.js";
import type { AnyContext, ContextId, Message } from "./context-types.js";
import type { ContextStore } from "./context-store.js";
import { runContextsWithPi, type PiRuntime, type PiRuntimeRunHooks } from "./pi-runtime.js";
import type { PiProjectionMode } from "./pi-projection.js";

export type ConversationIdGenerator = (prefix: string) => ContextId;

export type CreateConversationInput = {
  store: ContextStore;
  runtime: PiRuntime;
  threadId: ContextId;
  userId?: ContextId;
  agentId?: ContextId;
  idGenerator?: ConversationIdGenerator;
  projectionMode?: PiProjectionMode;
  systemPrompt?: string;
  journal?: ContextJournal;
};

export interface Conversation {
  threadId: ContextId;
  sendUserMessage(text: string, hooks?: PiRuntimeRunHooks): Promise<Message>;
  listThread(): AnyContext[];
}

function defaultIdGenerator(prefix: string): ContextId {
  return `${prefix}:${randomUUID()}`;
}

function appendContext(
  store: ContextStore,
  context: AnyContext,
  journal?: ContextJournal,
): void {
  store.append(context);
  journal?.append(context);
}

export function createConversation(input: CreateConversationInput): Conversation {
  const idGenerator = input.idGenerator ?? defaultIdGenerator;

  if (!input.store.get(input.threadId)) {
    appendContext(
      input.store,
      createContextNode({
        id: input.threadId,
        type: "thread",
        payload: {},
      }),
      input.journal,
    );
  }

  return {
    threadId: input.threadId,

    async sendUserMessage(text: string, hooks?: PiRuntimeRunHooks): Promise<Message> {
      const previousMessage = input.store.latestMessage(input.threadId);
      const userMessage = createContextNode({
        id: idGenerator("message"),
        type: "message",
        createdBy: input.userId,
        payload: {
          role: "user" as const,
          text,
          threadId: input.threadId,
          previousMessageId: previousMessage?.id,
        },
      });

      appendContext(input.store, userMessage, input.journal);

      const runtimeHooks: PiRuntimeRunHooks = {
        onTextDelta(delta) {
          hooks?.onTextDelta?.(delta);
        },
        onToolCall(event) {
          const toolCallContextId = `toolcall:${event.toolCallId}`;

          if (!input.store.get(toolCallContextId)) {
            appendContext(
              input.store,
              createContextNode({
                id: toolCallContextId,
                type: "tool-call",
                createdBy: input.agentId,
                payload: {
                  tool: event.tool,
                  args: event.args,
                  threadId: input.threadId,
                  targetId: userMessage.id,
                },
              }),
              input.journal,
            );
          }

          hooks?.onToolCall?.(event);
        },
        onToolResult(event) {
          const toolResultContextId = `toolresult:${event.toolCallId}`;

          if (!input.store.get(toolResultContextId)) {
            appendContext(
              input.store,
              createContextNode({
                id: toolResultContextId,
                type: "tool-result",
                createdBy: input.agentId,
                payload: {
                  output: event.output,
                  threadId: input.threadId,
                  toolCallId: `toolcall:${event.toolCallId}`,
                  isError: event.isError,
                },
              }),
              input.journal,
            );
          }

          hooks?.onToolResult?.(event);
        },
      };

      const assistantMessage = await runContextsWithPi({
        runtime: input.runtime,
        contexts: input.store.listThread(input.threadId),
        messageId: idGenerator("message"),
        threadId: input.threadId,
        previousMessageId: userMessage.id,
        createdBy: input.agentId,
        hooks: runtimeHooks,
        projectionMode: input.projectionMode,
        systemPrompt: input.systemPrompt,
      });

      appendContext(input.store, assistantMessage, input.journal);
      return assistantMessage;
    },

    listThread() {
      return input.store.listThread(input.threadId);
    },
  };
}
