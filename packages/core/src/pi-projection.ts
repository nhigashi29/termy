import { toContextText } from "./context-text.js";
import type { AnyContext, ContextId } from "./context-types.js";

export type PiProjectionMode = "conversation-only" | "with-tool-results";

export type PiProjection = {
  systemPrompt?: string;
  transcript: string;
};

export type CreatePiProjectionInput = {
  contexts: AnyContext[];
  threadId?: ContextId;
  mode?: PiProjectionMode;
  systemPrompt?: string;
};

function isProjectedContext(
  context: AnyContext,
  mode: PiProjectionMode,
  threadId?: ContextId,
): boolean {
  if (context.type === "thread") {
    return threadId === undefined || context.id === threadId;
  }

  if (context.type === "message") {
    return threadId === undefined || context.payload.threadId === threadId;
  }

  if (mode === "with-tool-results") {
    if (context.type === "tool-call" || context.type === "tool-result") {
      return threadId === undefined || context.payload.threadId === threadId;
    }
  }

  return false;
}

export function projectContextsToPi(input: CreatePiProjectionInput): PiProjection {
  const mode = input.mode ?? "conversation-only";
  const transcript = input.contexts
    .filter((context) => isProjectedContext(context, mode, input.threadId))
    .map(toContextText)
    .join("\n");

  return {
    systemPrompt: input.systemPrompt,
    transcript,
  };
}
