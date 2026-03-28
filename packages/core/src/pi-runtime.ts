import { createContextNode } from "./context.js";
import type { AnyContext, ContextId, Message } from "./context-types.js";
import { projectContextsToPi, type PiProjectionMode } from "./pi-projection.js";

export type PiRunRequest = {
  input: string;
  systemPrompt?: string;
};

export type PiRunResult = {
  output: string;
};

export type PiRuntimeToolCallEvent = {
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
};

export type PiRuntimeToolResultEvent = {
  toolCallId: string;
  tool: string;
  output: unknown;
  isError: boolean;
};

export type PiRuntimeRunHooks = {
  onTextDelta?: (delta: string) => void;
  onToolCall?: (event: PiRuntimeToolCallEvent) => void;
  onToolResult?: (event: PiRuntimeToolResultEvent) => void;
};

export interface PiRuntime {
  run(request: PiRunRequest, hooks?: PiRuntimeRunHooks): Promise<PiRunResult>;
}

export type ToPiInputOptions = {
  threadId?: ContextId;
  projectionMode?: PiProjectionMode;
  systemPrompt?: string;
};

export function toPiInput(
  contexts: AnyContext[],
  options: ToPiInputOptions = {},
): PiRunRequest {
  const projection = projectContextsToPi({
    contexts,
    threadId: options.threadId,
    mode: options.projectionMode,
    systemPrompt: options.systemPrompt,
  });

  return {
    input: projection.transcript,
    systemPrompt: projection.systemPrompt,
  };
}

export type CreateAssistantMessageFromPiResultInput = {
  id: ContextId;
  threadId: ContextId;
  previousMessageId?: ContextId;
  createdBy?: ContextId;
  result: PiRunResult;
};

export function createAssistantMessageFromPiResult(
  input: CreateAssistantMessageFromPiResultInput,
): Message {
  return createContextNode({
    id: input.id,
    type: "message",
    createdBy: input.createdBy,
    payload: {
      role: "assistant",
      text: input.result.output,
      threadId: input.threadId,
      previousMessageId: input.previousMessageId,
    },
  });
}

export type RunContextsWithPiInput = {
  runtime: PiRuntime;
  contexts: AnyContext[];
  messageId: ContextId;
  threadId: ContextId;
  previousMessageId?: ContextId;
  createdBy?: ContextId;
  hooks?: PiRuntimeRunHooks;
  projectionMode?: PiProjectionMode;
  systemPrompt?: string;
};

export async function runContextsWithPi(
  input: RunContextsWithPiInput,
): Promise<Message> {
  const result = await input.runtime.run(
    toPiInput(input.contexts, {
      threadId: input.threadId,
      projectionMode: input.projectionMode,
      systemPrompt: input.systemPrompt,
    }),
    input.hooks,
  );

  return createAssistantMessageFromPiResult({
    id: input.messageId,
    threadId: input.threadId,
    previousMessageId: input.previousMessageId,
    createdBy: input.createdBy,
    result,
  });
}
