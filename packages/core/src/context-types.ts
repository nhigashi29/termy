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
    key?: string;
    name?: string;
  }
>;

export type AgentContext = ContextNode<
  "agent",
  {
    key?: string;
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

export type ThreadMode = "conversation" | "meeting" | "broadcast" | "stream";
export type ThreadTurnPolicy = "free" | "round-robin" | "manager-mediated";

export type Thread = ContextNode<
  "thread",
  {
    key?: string;
    name?: string;
    mode?: ThreadMode;
    participantIds?: ContextId[];
    turnPolicy?: ThreadTurnPolicy;
  }
>;

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
    runtimeToolCallId?: string;
    toolDefinitionId?: ContextId;
    targetId?: ContextId;
  }
>;

export type ToolResult = ContextNode<
  "tool-result",
  {
    output: unknown;
    threadId?: ContextId;
    runtimeToolCallId?: string;
    toolCallId?: ContextId;
    isError?: boolean;
  }
>;

export type TaskStatus = "pending" | "in-progress" | "done" | "failed";

export type Task = ContextNode<
  "task",
  {
    parentThreadId: ContextId;
    workerThreadId?: ContextId;
    assignedTo: ContextId;
    instruction: string;
    title?: string;
  }
>;

export type TaskStatusChange = ContextNode<
  "task-status",
  {
    taskId: ContextId;
    status: TaskStatus;
    reason?: string;
  }
>;

export type TaskResult = ContextNode<
  "task-result",
  {
    taskId: ContextId;
    threadId: ContextId;
    output: unknown;
  }
>;

export type AgentRunStatus = "idle" | "running" | "waiting" | "stopped";

export type AgentStatus = ContextNode<
  "agent-status",
  {
    agentId: ContextId;
    status: AgentRunStatus;
    taskId?: ContextId;
    threadId?: ContextId;
  }
>;

export type Notification = ContextNode<
  "notification",
  {
    kind: string;
    targetAgentId?: ContextId;
    taskId?: ContextId;
    threadId?: ContextId;
    message?: string;
  }
>;

export type NotificationSubscription = {
  subscriberAgentId: ContextId;
  kinds: string[];
};

export type ReplyRequest = ContextNode<
  "reply-request",
  {
    threadId: ContextId;
    requestedFrom: ContextId;
    requestedBy?: ContextId;
    taskId?: ContextId;
    message?: string;
  }
>;

export type MeetingTurn = ContextNode<
  "meeting-turn",
  {
    threadId: ContextId;
    requestedFrom: ContextId;
    requestedBy?: ContextId;
    taskId?: ContextId;
    agenda?: string;
  }
>;

export type MeetingState = ContextNode<
  "meeting-state",
  {
    threadId: ContextId;
    status: "open" | "paused" | "closed";
    facilitatorId?: ContextId;
    objective?: string;
  }
>;

export type AnyContext =
  | User
  | AgentContext
  | System
  | Session
  | Thread
  | Message
  | Capability
  | ToolDefinition
  | ToolCall
  | ToolResult
  | Task
  | TaskStatusChange
  | TaskResult
  | AgentStatus
  | Notification
  | ReplyRequest
  | MeetingTurn
  | MeetingState;
