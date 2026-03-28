export type ContextId = string;

export type ContextNode<
  TType extends string = string,
  TPayload = unknown,
> = {
  id: ContextId;
  type: TType;
  payload: TPayload;
  createdAt: Date;
  createdBy?: ContextId;
};

export type User = ContextNode<
  "user",
  {
    name?: string;
  }
>;

export type Agent = ContextNode<
  "agent",
  {
    name?: string;
    role?: string;
  }
>;

export type System = ContextNode<
  "system",
  {
    name?: string;
  }
>;

export type Session = ContextNode<"session", Record<string, never>>;

export type Thread = ContextNode<"thread", Record<string, never>>;

export type Message = ContextNode<
  "message",
  {
    role: "user" | "assistant" | "system";
    text: string;
    threadId: ContextId;
    previousMessageId?: ContextId;
  }
>;

export type Capability = ContextNode<
  "capability",
  {
    action: string;
    targetType?: string;
    toolDefinitionId?: ContextId;
  }
>;

export type ToolDefinition = ContextNode<
  "tool-definition",
  {
    name: string;
    description: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }
>;

export type ToolCall = ContextNode<
  "tool-call",
  {
    tool: string;
    args: Record<string, unknown>;
    threadId?: ContextId;
    toolDefinitionId?: ContextId;
    targetId?: ContextId;
  }
>;

export type ToolResult = ContextNode<
  "tool-result",
  {
    output: unknown;
    threadId?: ContextId;
    toolCallId?: ContextId;
    isError?: boolean;
  }
>;

export type AnyContext =
  | User
  | Agent
  | System
  | Session
  | Thread
  | Message
  | Capability
  | ToolDefinition
  | ToolCall
  | ToolResult;
