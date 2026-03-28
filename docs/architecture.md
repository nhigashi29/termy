# Architecture

`termy` is a small pnpm workspace monorepo.

## Packages

- `packages/core` — shared agent logic and reusable runtime pieces
- `packages/cli` — terminal entrypoint and user interaction

## Current direction

Keep package boundaries simple:

- put reusable logic in `@termy/core`
- keep terminal-specific code in `@termy/cli`
- add more packages only when a boundary becomes clearly useful
