# AGENTS.md

Guidance for coding agents working in this repository.

## References

- Project overview: [`README.md`](README.md)
- Contributor workflow: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Architecture notes: [`docs/architecture.md`](docs/architecture.md)

## Agent-specific guidance

- Keep changes small and focused.
- Put reusable logic in `packages/core`.
- Keep terminal-specific behavior in `packages/cli`.
- Use `tmp/` as a temporary working area for notes, sketches, and intermediate artifacts.
- Do not treat `tmp/` contents as stable project documentation unless explicitly promoted into tracked docs/code.
- Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before making commits, and follow its commit message guidance.
- Update referenced docs when structure or workflow changes.
