# Contributing

This project is a small pnpm workspace monorepo for experimenting with a terminal-based agent.

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

## Project structure

See [`docs/architecture.md`](docs/architecture.md).

## Commit messages

Use simple conventional-style commit messages when possible.

### Preferred prefixes

- `feat:` — new functionality
- `fix:` — bug fixes
- `docs:` — documentation changes
- `refactor:` — code structure improvements without behavior changes
- `chore:` — tooling, config, or maintenance updates

### Examples

- `feat: add basic CLI loop`
- `fix: handle empty input in repl`
- `docs: add project README`
- `refactor: move agent logic to core`
- `chore: setup pnpm workspace`
