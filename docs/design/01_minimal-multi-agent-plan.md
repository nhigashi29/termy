# 01 Minimal Multi-Agent Plan

This document describes the smallest practical path from the current implementation to a first working multi-agent coordination milestone.

It is intentionally narrow.
The goal is not to build the full target architecture yet.
The goal is to make one real coordination loop work:

> **manager creates a task, worker processes it, manager incorporates the result**

See also:

- [`../architecture.md`](../architecture.md)
- [`goal-architecture.md`](goal-architecture.md)
- [`context-control-plane.md`](context-control-plane.md)
- [`implementation-plan.md`](implementation-plan.md)

---

## Target milestone

The first milestone should support this flow:

1. user sends a request
2. manager receives the request in the main thread
3. manager creates a `Task` for a worker
4. execution engine picks up the task
5. worker runs in its own thread
6. worker appends a `TaskResult`
7. manager reads the result and produces the final response

This is enough to prove that `termy` can support real multi-agent coordination.

---

## Why this is the right first step

The current codebase already has the most important primitives:

- append-only `ContextStore`
- durable JSONL journal
- thread-scoped `Conversation`
- `PiRuntime` abstraction
- persisted `tool-call` and `tool-result` contexts

That means the shortest path is not to invent a whole new runtime.
It is to reuse the existing conversation runtime and add the minimum coordination layer on top.

The key insight is:

- **manager thread** = one working context
- **worker thread** = another working context
- **task contexts** = the bridge between them

---

## Current implementation constraints

A few current constraints shape this plan:

### 1. `Conversation` is thread-scoped

This is actually helpful for the first milestone.
A worker can simply run in a separate thread.

### 2. `PiRuntime` currently returns one final `Message`

This is slightly narrower than the long-term design, but still sufficient for the first milestone.
The engine can wrap the worker's final message into a `TaskResult`.

### 3. `ContextStore` does not yet expose task queries

This means we need to add a few task-specific query helpers before an execution engine can work cleanly.

### 4. There is no execution engine yet

So the first version should be very small and explicit.
A manual `tick()`-based engine is enough.

---

## Scope of this plan

### In scope

- `Task`, `TaskStatusChange`, `TaskResult`
- minimal task queries in `ContextStore`
- a minimal execution engine with `tick()`
- a manager role and one worker role
- worker execution in a separate thread
- manager reading worker output and replying to the user

### Out of scope for the first milestone

- channels
- notifications
- semantic recall
- dynamic capability routing
- runtime spawn as a separate process
- full `AnyContext[]` return path from runtime
- broadcast / meeting / stream modes

---

## Proposed implementation phases

---

## Phase 1 — Add task contexts

### Goal

Introduce the minimum context types needed for delegation.

### Files

- `packages/core/src/context-types.ts`
- `packages/core/src/index.ts`
- optionally `packages/core/src/context-text.ts`

### Changes

Add these context types:

```ts
type Task = ContextNode<"task", {
  parentThreadId: ContextId;
  workerThreadId?: ContextId;
  assignedTo: ContextId;
  instruction: string;
  title?: string;
}>;

type TaskStatusChange = ContextNode<"task-status", {
  taskId: ContextId;
  status: "pending" | "in-progress" | "done" | "failed";
  reason?: string;
}>;

type TaskResult = ContextNode<"task-result", {
  taskId: ContextId;
  threadId: ContextId;
  output: unknown;
}>;
```

Add them to `AnyContext`.

### Why this shape

- `Task` is the assignment
- `TaskStatusChange` preserves append-only semantics
- `TaskResult` gives worker output a first-class coordination type

Do not put mutable status directly inside `Task`.

---

## Phase 2 — Extend `ContextStore` with task queries

### Goal

Make task lookup possible without introducing a complex query layer.

### Files

- `packages/core/src/context-store.ts`

### Changes

Add minimal helpers:

```ts
listPendingTasks(agentId: ContextId): Task[];
latestTaskStatus(taskId: ContextId): TaskStatusChange | undefined;
listTaskResults(taskId: ContextId): TaskResult[];
```

Optionally also add:

```ts
listTasksForThread(threadId: ContextId): Task[];
```

### Notes

The first version can be implemented by scanning the in-memory array.
No indexing is required yet.

---

## Phase 3 — Add a minimal execution engine

### Goal

Create the smallest runtime loop that can dispatch worker tasks.

### Files

- `packages/core/src/execution-engine.ts` (new)
- `packages/core/src/index.ts`

### Shape

The first version should be explicit and simple:

```ts
interface ExecutionEngine {
  tick(): Promise<void>;
}
```

### Responsibilities

`tick()` should:

1. find pending tasks for registered worker agents
2. append `task-status: in-progress`
3. run the assigned worker
4. append `task-result`
5. append `task-status: done`
6. on error, append `task-status: failed`

### Important design choice

Do not build subscriptions yet.
Manual `tick()` is enough for the first milestone and easier to debug.

---

## Phase 4 — Reuse `Conversation` for worker execution

### Goal

Run a worker in its own thread without inventing a second runtime stack.

### Files

- `packages/core/src/execution-engine.ts`
- possibly helper file such as `packages/core/src/task-runner.ts`

### Approach

For each pending task:

1. create or ensure a worker thread
2. create a `Conversation` for that worker thread
3. call `conversation.sendUserMessage(task.instruction)`
4. wrap the returned assistant `Message` into a `TaskResult`

### Why this is good

This reuses existing code for:

- projection
- runtime invocation
- tool persistence
- journaling

It also means worker tool activity naturally lives in the worker thread.

---

## Phase 5 — Add manager and worker identities

### Goal

Make coordination visible in the context log, even if both roles use the same underlying runtime.

### Files

- `packages/cli/src/index.ts`

### Changes

Ensure at least two agent contexts exist:

- `manager`
- one worker, for example `worker:reader`

Example intent:

- manager receives user goals
- worker handles one delegated unit of work

### Notes

For the first milestone, both roles may still use the same `PiRuntime` implementation.
Role separation in context is enough.

---

## Phase 6 — Wire a fixed delegation flow into the CLI

### Goal

Make the coordination loop visible end-to-end.

### Files

- `packages/cli/src/index.ts`

### First implementation strategy

Do not ask the manager model to decide whether to delegate yet.
Instead, hard-code a first delegation path in the CLI orchestration.

Suggested flow:

1. user enters text
2. create a task assigned to the worker
3. call `engine.tick()`
4. read the `TaskResult`
5. send a manager message that incorporates the worker result

### Why hard-code first

This validates the architecture itself before adding LLM-driven planning.
It keeps the first milestone small and deterministic.

---

## Phase 7 — Let the manager synthesize the final answer

### Goal

Keep the final user response manager-owned instead of returning worker output directly.

### Files

- `packages/cli/src/index.ts`
- maybe helper logic in `packages/core`

### Approach

After the worker produces a `TaskResult`, append a manager-thread user/system message like:

- "Worker result for task X: ..."

Then run the manager conversation again so the manager produces the final assistant message.

### Why this matters

It preserves a clean separation:

- worker does sub-work
- manager owns the final answer

That is a real coordination pattern, not just a background helper call.

---

## Recommended file-by-file plan

### `packages/core/src/context-types.ts`

Add:

- `Task`
- `TaskStatusChange`
- `TaskResult`
- union updates

### `packages/core/src/context-store.ts`

Add:

- task query helpers
- thread scoping updates if needed for task visibility

### `packages/core/src/execution-engine.ts`

Create:

- `createExecutionEngine(...)`
- `tick()`

### `packages/core/src/index.ts`

Export:

- new task types
- execution engine

### `packages/cli/src/index.ts`

Update:

- ensure manager and worker contexts
- create task
- run engine
- feed result back to manager

---

## Suggested first demo

A good first demo is intentionally simple.

### Example

User asks:

> summarize README.md

Flow:

1. manager receives the request
2. code creates a worker task:
   - instruction: "Read README.md and summarize the key points"
3. engine dispatches worker
4. worker runs in its own thread and uses tools
5. worker appends `TaskResult`
6. manager reads the task result and produces the final answer

This is enough to prove:

- manager/worker separation
- task-based delegation
- thread-scoped context isolation
- persisted coordination records

---

## Risks and tradeoffs

### 1. Same runtime for manager and worker

This is acceptable for the first milestone.
Role-specific prompts can come later.

### 2. No automatic subscriptions yet

Also acceptable.
Manual `tick()` is simpler and easier to verify.

### 3. `PiRuntime` still returns only a final message

This is acceptable for now.
The engine can convert that final worker message into `TaskResult`.

### 4. Task planning is hard-coded at first

That is a feature, not a bug.
It isolates architectural validation from model behavior.

---

## Milestones

### Milestone 1

Task contexts exist and can be stored and queried.

### Milestone 2

Execution engine can pick up one worker task and run it in a worker thread.

### Milestone 3

Manager can read worker result and produce a final response.

### Milestone 4

CLI demonstrates a full end-to-end delegation flow.

---

## Definition of done for the first coordination milestone

`termy` should be considered to have reached its first multi-agent coordination milestone when:

- a manager task can be persisted as a `Task`
- a worker can be assigned explicitly
- worker execution occurs in a separate thread
- worker output is persisted as `TaskResult`
- manager produces the final response using that result
- all of the above are visible in the context log and journal

That is the smallest coherent proof that the architecture can support multi-agent coordination.
