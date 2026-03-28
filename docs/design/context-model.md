# Context Model

## Everything is Context

The central design principle: all information in the system is a `ContextNode`.

```ts
type ContextNode<TType, TPayload> = {
  id: ContextId;
  type: TType;
  payload: TPayload;
  createdAt: Date;
  createdBy?: ContextId;  // who produced this context
};
```

Actors, messages, tool executions, tasks, and communication channels are all contexts. There is no privileged runtime object — only nodes in a shared store.

## Why this works

A uniform data model means:

- **Observable**: everything that happens is recorded as a context
- **Serializable**: the full system state is a list of context nodes (JSONL journal)
- **Composable**: agents read contexts and write contexts — the same interface at every level
- **Replayable**: restore prior state by replaying the journal into a fresh store

## Context categories

| Category     | Types                                                    |
|--------------|----------------------------------------------------------|
| Actors       | `User`, `Agent`, `System`                                |
| Conversation | `Channel`, `Thread`, `Message`                           |
| Runtime      | `Session`                                                |
| Execution    | `Capability`, `ToolDefinition`, `ToolCall`, `ToolResult` |
| Work         | `Task`, `TaskResult`, `TaskStatusChange` (planned)       |

## Conversation hierarchy

The intended long-term hierarchy is:

- `Channel` — a shared conversation space that groups related threads
- `Thread` — a scoped conversation within a channel
- `Message` — an utterance within a thread

In this model, `Channel` is the place and `Thread` is the individual line of discussion.
This maps better to systems where one channel contains multiple concurrent sub-conversations.

`Session` is different: it represents a runtime interaction instance, such as one CLI/app session, not a logical conversation container.

## Append-only store

`ContextStore` is an append-only in-memory log. Contexts are never mutated or deleted.

For mutable concepts like task status, changes are expressed as new contexts:

```ts
// not: store.update(taskId, { status: "done" })
// instead:
store.append({ type: "task-status", payload: { taskId, status: "done" } })
```

Current status is derived by reading the latest `task-status` for a given task id.

This keeps the store a faithful event log and makes history auditable.

## Agent as a context processor

The intended signature for any agent at any level:

```ts
type AgentRun = (contexts: AnyContext[]) => Promise<AnyContext[]>
```

An agent reads contexts and writes contexts. Nothing more.
