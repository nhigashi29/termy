# termy

A small terminal agent project built as a pnpm workspace monorepo.

## Packages

- `@termy/core` — core agent logic
- `@termy/cli` — terminal CLI

## Development

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

## Current status

This is an early scaffold for experimenting with a terminal-based agent.
Right now it includes:

- a workspace setup with `core` and `cli`
- a simple REPL
- a minimal core agent function
