export interface AgentOptions {
  name?: string;
}

export interface Agent {
  name: string;
  run(input: string): Promise<string>;
}

export function createAgent(options: AgentOptions = {}): Agent {
  const name = options.name ?? "termy";

  return {
    name,
    async run(input: string) {
      const text = String(input ?? "").trim();

      console.log(`[core] agent received: ${text}`);

      if (!text) {
        return "何か入力してね。";
      }

      return `${name}: you said -> ${text}`;
    },
  };
}
