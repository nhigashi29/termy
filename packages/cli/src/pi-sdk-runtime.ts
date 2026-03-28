import { createAgentSession } from "@mariozechner/pi-coding-agent";
import type { PiRunRequest, PiRunResult, PiRuntime } from "@termy/core";

export async function createPiSdkRuntime(): Promise<PiRuntime> {
  const { session } = await createAgentSession({
    cwd: process.cwd(),
  });

  return {
    async run(request: PiRunRequest): Promise<PiRunResult> {
      let output = "";

      const unsubscribe = session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          output += event.assistantMessageEvent.delta;
        }
      });

      try {
        await session.prompt(request.input);
        return { output };
      } finally {
        unsubscribe();
      }
    },
  };
}
