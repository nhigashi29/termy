import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AnyContext } from "./context-types.js";
import type { ContextJournal } from "./context-journal.js";

function serializeContext(context: AnyContext): string {
  return JSON.stringify({
    ...context,
    createdAt: context.createdAt.toISOString(),
  });
}

function deserializeContext(line: string): AnyContext {
  const parsed = JSON.parse(line) as Omit<AnyContext, "createdAt"> & { createdAt: string };

  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
  } as AnyContext;
}

export function createJsonlContextJournal(path: string): ContextJournal {
  mkdirSync(dirname(path), { recursive: true });

  return {
    append(context) {
      appendFileSync(path, `${serializeContext(context)}\n`, "utf8");
    },

    appendMany(contexts) {
      if (contexts.length === 0) {
        return;
      }

      const content = contexts.map((context) => serializeContext(context)).join("\n");
      appendFileSync(path, `${content}\n`, "utf8");
    },
  };
}

export function loadContextsFromJsonl(path: string): AnyContext[] {
  if (!existsSync(path)) {
    return [];
  }

  const content = readFileSync(path, "utf8").trim();

  if (!content) {
    return [];
  }

  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(deserializeContext);
}
