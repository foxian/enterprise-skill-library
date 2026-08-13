# Agent Instructions

- Project conventions live in [docs/agent-coding-principles.md](docs/agent-coding-principles.md).
- Docker local runtime setup lives in [DOCKER_SETUP.md](DOCKER_SETUP.md).
- Keep reusable logic in `packages/core`; keep CLI parsing, output, and exit behavior in `packages/cli`.
- Verify changes with `npm test` and `npm run build`.

## Agent skills

### Issue tracker

Issues and specs for this repo live as markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to the repo's local label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses single-context domain docs: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

<!-- ESL-AUTO-GENERATED-START -->
<!-- Future `esl adapt codex` output goes here. Do not edit this block manually. -->
<!-- ESL-AUTO-GENERATED-END -->
