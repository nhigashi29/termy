# termy

A context-first terminal agent experiment built as a pnpm workspace monorepo.

`termy` explored an architecture where conversation state, tool activity, delegation, and future agent coordination are represented as append-only context records.

## Project status

This project is now **paused / closed as an experiment**.

The main outcome is not a finished product, but a set of architectural lessons:

- a **context model** can be designed independently from the runtime
- append-only context records work well as the source of truth for coordination state
- **task / subagent-based orchestration** is more practical than trying to rely on notifications alone
- **notifications are useful**, but they are not enough to carry the full orchestration model
- **runtime scheduling and execution policy must be treated as a separate layer**

In short:

> The strongest result from this repository is that **context-first modeling is promising**, but **context model and runtime model should be separated**.

## What the project built

Even in its experimental form, `termy` includes:

- a pnpm workspace with `core` and `cli`
- a terminal REPL
- an append-only in-memory `ContextStore`
- JSONL-based context persistence
- thread-scoped conversation orchestration
- runtime projection from stored contexts into model input
- persisted tool calls and tool results
- task creation, task status tracking, and task result collection
- notification, clarification, and meeting-related context types
- an execution engine with task dispatch and reactive scheduling

## Main takeaway

A useful refined version of the original idea is:

> **Everything important to coordination should be represented as context, but execution policy belongs to the runtime.**

That means:

### Context model

The context layer is a durable, inspectable representation of coordination facts such as:

- threads
- messages
- tasks
- task-status
- task-result
- notifications
- reply requests
- meeting turns / meeting state

### Runtime model

The runtime layer decides how those contexts are acted on:

- when agents are dispatched
- how pending work is queued
- how reactions are batched
- whether runs are blocking or non-blocking
- how waiting, retry, and timeout behavior works

This separation turned out to be one of the clearest lessons from the project.

## Packages

- `@termy/core` — core context model, storage, projection, commands, and execution engine
- `@termy/cli` — terminal CLI and Pi SDK-backed runtime wiring

## Development

The repository is left in a working experimental state.

Install dependencies:

```bash
pnpm install
```

Run the CLI in dev mode:

```bash
pnpm dev
```

Build all packages:

```bash
pnpm build
```

Run the built CLI:

```bash
pnpm start
```

## Docs

Since the project is now closed, the documentation is best read in two groups:

### Final summary

- [`docs/retrospective.md`](docs/retrospective.md) — project summary and final lessons learned
- [`docs/architecture.md`](docs/architecture.md) — snapshot of the implemented architecture
- [`docs/context-model.md`](docs/context-model.md) — context-first design philosophy

### Design archive

These documents capture the design path, open questions, and intermediate proposals explored during the experiment.
They are useful as references, but should be read as design notes rather than an active roadmap.

- [`docs/design/context-model.md`](docs/design/context-model.md)
- [`docs/design/communication-patterns.md`](docs/design/communication-patterns.md)
- [`docs/design/implementation-plan.md`](docs/design/implementation-plan.md)
- [`docs/design/multi-agent.md`](docs/design/multi-agent.md)
- [`docs/design/goal-architecture.md`](docs/design/goal-architecture.md)
- [`docs/design/context-control-plane.md`](docs/design/context-control-plane.md)
- [`docs/design/06_async-task-semantics-and-notifications.md`](docs/design/06_async-task-semantics-and-notifications.md)
- [`docs/design/07_reactive-orchestration-and-manager-event-loop.md`](docs/design/07_reactive-orchestration-and-manager-event-loop.md)

### Repository meta

- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`AGENTS.md`](AGENTS.md)
