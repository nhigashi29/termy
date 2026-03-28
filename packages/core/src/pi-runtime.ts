import { createContextNode } from "./context.js";
import { toContextText } from "./context-text.js";
import type { AnyContext, ContextId, Message } from "./context-types.js";

export type PiRunRequest = {
  input: string;
};

export type PiRunResult = {
  output: string;
};

export interface PiRuntime {
  run(request: PiRunRequest): Promise<PiRunResult>;
}

export function toPiInput(contexts: AnyContext[]): PiRunRequest {
  return {
    input: contexts.map(toContextText).join("\n"),
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
};

export async function runContextsWithPi(
  input: RunContextsWithPiInput,
): Promise<Message> {
  const result = await input.runtime.run(toPiInput(input.contexts));

  return createAssistantMessageFromPiResult({
    id: input.messageId,
    threadId: input.threadId,
    previousMessageId: input.previousMessageId,
    createdBy: input.createdBy,
    result,
  });
}
