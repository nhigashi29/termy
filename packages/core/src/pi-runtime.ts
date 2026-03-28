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
