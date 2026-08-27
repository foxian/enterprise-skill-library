# Agent Instructions

- Use Simplified Chinese for all communication and interaction with the user (including code comments, commit messages, and documentation where appropriate). 与用户的所有沟通和交流应使用简体中文。
- Project conventions live in [docs/agent-coding-principles.md](docs/agent-coding-principles.md).
- Docker local runtime guidance lives in
  [docs/guides/local-development.md](docs/guides/local-development.md).
- Docker-specific diagnosis lives in
  [docs/guides/docker-troubleshooting.md](docs/guides/docker-troubleshooting.md).
- Keep reusable logic in `packages/core`; keep CLI parsing, output, and exit behavior in `packages/cli`.
- Verify changes with `npm test` and `npm run build`.
- Any change to the `esl` CLI's commands, flags, or behavior must also update the client-coupled built-in skill `skills/esl-operator/` (`SKILL.md` and its `references/`), so the operator skill matches the CLI it ships with. Treat this as part of the same change, not a follow-up. When in doubt, check `docs/adr/0008` for the client-coupled contract and keep the two in lockstep.

## Agent skills

### Issue tracker

Issues and specs for this repo live as GitHub issues in `foxian/enterprise-skill-library`, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to the repo's local label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses single-context domain docs: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

<!-- ESL-AUTO-GENERATED-START -->
<!-- Future `esl adapt codex` output goes here. Do not edit this block manually. -->
<!-- ESL-AUTO-GENERATED-END -->
