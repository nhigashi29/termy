import { match } from "ts-pattern";

import type { AnyContext } from "./context-types.js";

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

export function toContextText(context: AnyContext): string {
  return match(context)
    .with({ type: "user" }, (context) => `user ${context.payload.name ?? context.id}`)
    .with(
      { type: "agent" },
      (context) =>
        `agent ${context.payload.name ?? context.id}${
          context.payload.role ? ` (${context.payload.role})` : ""
        }`,
    )
    .with({ type: "system" }, (context) => `system ${context.payload.name ?? context.id}`)
    .with({ type: "session" }, (context) => `session ${context.id}`)
    .with({ type: "thread" }, (context) => `thread ${context.id}`)
    .with({ type: "message" }, (context) => `${context.payload.role}: ${context.payload.text}`)
    .with(
      { type: "capability" },
      (context) =>
        `capability ${context.payload.action}${
          context.payload.targetType ? ` -> ${context.payload.targetType}` : ""
        }`,
    )
    .with(
      { type: "tool-definition" },
      (context) => `tool ${context.payload.name}: ${context.payload.description}`,
    )
    .with(
      { type: "tool-call" },
      (context) => `tool-call ${context.payload.tool} ${formatValue(context.payload.args)}`,
    )
    .with(
      { type: "tool-result" },
      (context) => `tool-result ${formatValue(context.payload.output)}`,
    )
    .exhaustive();
}
