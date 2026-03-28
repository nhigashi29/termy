export * from "./context-types.js";
export * from "./context.js";
export * from "./context-identity.js";
export * from "./context-text.js";
export * from "./context-store.js";
export * from "./context-journal.js";
export * from "./context-journal-jsonl.js";
export * from "./conversation.js";
export * from "./pi-projection.js";
export * from "./pi-runtime.js";

import type { PiRuntime } from "./pi-runtime.js";

export interface AgentOptions {
  name?: string;
  runtime: PiRuntime;
}

export interface Agent {
  name: string;
  run(input: string): Promise<string>;
}

export function createAgent(options: AgentOptions): Agent {
  const name = options.name ?? "termy";

  return {
    name,
    async run(input: string) {
      const text = String(input ?? "").trim();

      console.log(`[core] agent received: ${text}`);

      if (!text) {
        return "何か入力してね。";
      }

      const result = await options.runtime.run({ input: text });
      return result.output;
    },
  };
}
