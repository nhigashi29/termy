# termy

A context-first terminal agent experiment built as a pnpm workspace monorepo.

`termy` explores an architecture where conversation state, tool activity, and future agent coordination are represented as append-only context records.

## Packages

- `@termy/core` — core context model, storage, projection, and conversation orchestration
- `@termy/cli` — terminal CLI and Pi SDK-backed runtime wiring

## Current status

This project is still an early implementation, but it already includes:

- a pnpm workspace with `core` and `cli`
- a terminal REPL
- an append-only in-memory `ContextStore`
- JSONL-based context persistence
- thread-scoped conversation orchestration
- runtime projection from stored contexts into model input
- tool call and tool result persistence during runs

## Development

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Docs

- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`docs/architecture.md`](docs/architecture.md) — current implementation structure
- [`docs/context-model.md`](docs/context-model.md) — design philosophy
- [`docs/design/context-model.md`](docs/design/context-model.md) — future context model notes
- [`docs/design/communication-patterns.md`](docs/design/communication-patterns.md) — channel/thread/task design direction
- [`docs/design/implementation-plan.md`](docs/design/implementation-plan.md) — phased implementation ideas
- [`docs/design/multi-agent.md`](docs/design/multi-agent.md) — multi-agent coordination direction
- [`docs/design/goal-architecture.md`](docs/design/goal-architecture.md) — long-term target architecture
- [`docs/design/context-control-plane.md`](docs/design/context-control-plane.md) — why context needs explicit runtime control
- [`docs/design/06_async-task-semantics-and-notifications.md`](docs/design/06_async-task-semantics-and-notifications.md) — async task model, waiting, and notifications
- [`docs/design/07_reactive-orchestration-and-manager-event-loop.md`](docs/design/07_reactive-orchestration-and-manager-event-loop.md) — notification-driven runtime reactions and reactive orchestration
- [`AGENTS.md`](AGENTS.md)
