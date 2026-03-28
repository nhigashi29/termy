import type { AnyContext, ContextStore } from "@termy/core";

export function formatBackgroundEvent(store: ContextStore, context: AnyContext): string | undefined {
  if (context.type === "notification") {
    const taskLabel = context.payload.taskId ? ` ${context.payload.taskId}` : "";
    switch (context.payload.kind) {
      case "task-completed":
        return `[task done]${taskLabel}`;
      case "task-failed":
        return `[task failed]${taskLabel}${context.payload.message ? ` ${context.payload.message}` : ""}`;
      case "reply-available":
        return `[reply available]${taskLabel}${context.payload.targetAgentId ? ` for ${context.payload.targetAgentId}` : ""}`;
      case "clarification-requested":
        return `[clarification]${context.payload.targetAgentId ? ` -> ${context.payload.targetAgentId}` : ""}${context.payload.message ? ` ${context.payload.message}` : ""}`;
      default:
        return undefined;
    }
  }

  if (context.type === "reply-request") {
    return `[reply request] ${context.payload.requestedBy ?? "unknown"} -> ${context.payload.requestedFrom}${context.payload.message ? ` ${context.payload.message}` : ""}`;
  }

  if (context.type === "meeting-turn") {
    return `[meeting turn] ${context.payload.requestedBy ?? "unknown"} -> ${context.payload.requestedFrom}${context.payload.agenda ? ` ${context.payload.agenda}` : ""}`;
  }

  if (context.type === "message") {
    const thread = store.get(context.payload.threadId);
    if (thread?.type !== "thread") {
      return undefined;
    }

    const isBackgroundThread =
      context.payload.threadId === "thread:runtime-control" || thread.payload.mode === "meeting";

    if (!isBackgroundThread) {
      return undefined;
    }

    const threadName = thread.payload.name ?? thread.payload.key ?? thread.id;
    return `[${thread.payload.mode === "meeting" ? "meeting" : "background"}] ${threadName}: ${context.payload.text}`;
  }

  return undefined;
}
