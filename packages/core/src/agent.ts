import { createContextId } from "./context-identity.js";
import { createContextNode } from "./context.js";
import type { AnyContext, ContextId, Message, ToolCall, ToolResult } from "./context-types.js";
import type { ContextStore } from "./context-store.js";
import type { PiRuntime, PiRuntimeRunHooks } from "./pi-runtime.js";
import type { Projection } from "./projection.js";
import { conversationProjection } from "./projection.js";

export type AgentRunInput = {
  threadId: ContextId;
  contexts: AnyContext[];
  hooks?: PiRuntimeRunHooks;
};

export type AgentRunResult = {
  contexts: AnyContext[];
};

export interface Agent {
  id: ContextId;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export type CreateAgentInput = {
  id: ContextId;
  store: ContextStore;
  runtime: PiRuntime;
  projection?: Projection;
  systemPrompt?: string;
  idGenerator?: () => ContextId;
};

function findToolCallContext(
  contexts: AnyContext[],
  runtimeToolCallId: string,
): ToolCall | undefined {
  return contexts.find((context) => {
    return context.type === "tool-call" && context.payload.runtimeToolCallId === runtimeToolCallId;
  }) as ToolCall | undefined;
}

function findToolResultContext(
  contexts: AnyContext[],
  runtimeToolCallId: string,
): ToolResult | undefined {
  return contexts.find((context) => {
    return context.type === "tool-result" && context.payload.runtimeToolCallId === runtimeToolCallId;
  }) as ToolResult | undefined;
}

export function createAgent(input: CreateAgentInput): Agent {
  const idGenerator = input.idGenerator ?? createContextId;
  const projection = input.projection ?? conversationProjection(input.systemPrompt);

  return {
    id: input.id,

    async run(runInput: AgentRunInput): Promise<AgentRunResult> {
      const { threadId, contexts, hooks } = runInput;
      const produced: AnyContext[] = [];

      // Ensure thread exists in store
      if (!input.store.get(threadId)) {
        const threadContext = createContextNode({
          id: threadId,
          type: "thread",
          payload: {},
        });
        input.store.append(threadContext);
        produced.push(threadContext);
      }

      // Project contexts to transcript
      const projectionResult = projection(contexts, threadId);

      // Build runtime hooks that capture tool activity
      const runtimeHooks: PiRuntimeRunHooks = {
        onTextDelta(delta) {
          hooks?.onTextDelta?.(delta);
        },
        onToolCall(event) {
          const threadContexts = [...input.store.listThread(threadId), ...produced];
          const existingToolCall = findToolCallContext(threadContexts, event.toolCallId);

          if (!existingToolCall) {
            const toolCallContext = createContextNode({
              id: idGenerator(),
              type: "tool-call",
              createdBy: input.id,
              payload: {
                tool: event.tool,
                args: event.args,
                threadId,
                runtimeToolCallId: event.toolCallId,
              },
            });
            input.store.append(toolCallContext);
            produced.push(toolCallContext);
          }

          hooks?.onToolCall?.(event);
        },
        onToolResult(event) {
          const threadContexts = [...input.store.listThread(threadId), ...produced];
          const toolCallContext = findToolCallContext(threadContexts, event.toolCallId);
          const existingToolResult = findToolResultContext(threadContexts, event.toolCallId);

          if (!existingToolResult) {
            const toolResultContext = createContextNode({
              id: idGenerator(),
              type: "tool-result",
              createdBy: input.id,
              payload: {
                output: event.output,
                threadId,
                runtimeToolCallId: event.toolCallId,
                toolCallId: toolCallContext?.id,
                isError: event.isError,
              },
            });
            input.store.append(toolResultContext);
            produced.push(toolResultContext);
          }

          hooks?.onToolResult?.(event);
        },
      };

      // Call the runtime
      const result = await input.runtime.run(
        {
          input: projectionResult.transcript,
          systemPrompt: projectionResult.systemPrompt,
        },
        runtimeHooks,
      );

      // Create and store assistant message
      const previousMessage = input.store.latestMessage(threadId);
      const assistantMessage = createContextNode({
        id: idGenerator(),
        type: "message",
        createdBy: input.id,
        payload: {
          role: "assistant" as const,
          text: result.output,
          threadId,
          previousMessageId: previousMessage?.id,
        },
      });
      input.store.append(assistantMessage);
      produced.push(assistantMessage);

      return { contexts: produced };
    },
  };
}
