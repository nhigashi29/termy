import { createContextNode } from "./context.js";
import { createContextId } from "./context-identity.js";
import type { ContextJournal } from "./context-journal.js";
import type { AnyContext, ContextId, Message, ToolCall, ToolResult } from "./context-types.js";
import type { ContextStore } from "./context-store.js";
import { runContextsWithPi, type PiRuntime, type PiRuntimeRunHooks } from "./pi-runtime.js";
import type { PiProjectionMode } from "./pi-projection.js";

export type ConversationIdGenerator = () => ContextId;

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

function defaultIdGenerator(): ContextId {
  return createContextId();
}

function appendContext(
  store: ContextStore,
  context: AnyContext,
  journal?: ContextJournal,
): void {
  store.append(context);
  journal?.append(context);
}

function findToolCallContext(
  store: ContextStore,
  threadId: ContextId,
  runtimeToolCallId: string,
): ToolCall | undefined {
  return store.listThread(threadId).find((context) => {
    return context.type === "tool-call" && context.payload.runtimeToolCallId === runtimeToolCallId;
  }) as ToolCall | undefined;
}

function findToolResultContext(
  store: ContextStore,
  threadId: ContextId,
  runtimeToolCallId: string,
): ToolResult | undefined {
  return store.listThread(threadId).find((context) => {
    return context.type === "tool-result" && context.payload.runtimeToolCallId === runtimeToolCallId;
  }) as ToolResult | undefined;
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
        id: idGenerator(),
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
          const existingToolCall = findToolCallContext(
            input.store,
            input.threadId,
            event.toolCallId,
          );

          if (!existingToolCall) {
            appendContext(
              input.store,
              createContextNode({
                id: idGenerator(),
                type: "tool-call",
                createdBy: input.agentId,
                payload: {
                  tool: event.tool,
                  args: event.args,
                  threadId: input.threadId,
                  runtimeToolCallId: event.toolCallId,
                  targetId: userMessage.id,
                },
              }),
              input.journal,
            );
          }

          hooks?.onToolCall?.(event);
        },
        onToolResult(event) {
          const toolCallContext = findToolCallContext(input.store, input.threadId, event.toolCallId);
          const existingToolResult = findToolResultContext(
            input.store,
            input.threadId,
            event.toolCallId,
          );

          if (!existingToolResult) {
            appendContext(
              input.store,
              createContextNode({
                id: idGenerator(),
                type: "tool-result",
                createdBy: input.agentId,
                payload: {
                  output: event.output,
                  threadId: input.threadId,
                  runtimeToolCallId: event.toolCallId,
                  toolCallId: toolCallContext?.id,
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
        messageId: idGenerator(),
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
