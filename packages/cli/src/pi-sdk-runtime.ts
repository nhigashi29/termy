import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { PiRunRequest, PiRunResult, PiRuntime, PiRuntimeRunHooks } from "@termy/core";

import { createTermyTools, TERMY_SYSTEM_PROMPT } from "./termy-runtime-config.js";

export type CreatePiSdkRuntimeOptions = {
  cwd?: string;
  systemPrompt?: string;
  customTools?: ToolDefinition[];
};

export async function createPiSdkRuntime(
  options: CreatePiSdkRuntimeOptions = {},
): Promise<PiRuntime> {
  const cwd = options.cwd ?? process.cwd();
  const defaultSystemPrompt = options.systemPrompt ?? TERMY_SYSTEM_PROMPT;
  const customTools = options.customTools ?? [];

  return {
    async run(request: PiRunRequest, hooks?: PiRuntimeRunHooks): Promise<PiRunResult> {
      const systemPrompt = request.systemPrompt ?? defaultSystemPrompt;
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        systemPromptOverride: () => systemPrompt,
        appendSystemPromptOverride: () => [],
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        cwd,
        tools: createTermyTools(cwd),
        customTools,
        resourceLoader,
        sessionManager: SessionManager.inMemory(),
      });

      let output = "";

      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          output += event.assistantMessageEvent.delta;
          hooks?.onTextDelta?.(event.assistantMessageEvent.delta);
          return;
        }

        if (event.type === "tool_execution_start") {
          hooks?.onToolCall?.({
            toolCallId: event.toolCallId,
            tool: event.toolName,
            args: event.args,
          });
          return;
        }

        if (event.type === "tool_execution_end") {
          hooks?.onToolResult?.({
            toolCallId: event.toolCallId,
            tool: event.toolName,
            output: event.result,
            isError: event.isError,
          });
        }
      });

      try {
        await session.prompt(request.input);
        return { output };
      } finally {
        unsubscribe();
        session.dispose();
      }
    },
  };
}
