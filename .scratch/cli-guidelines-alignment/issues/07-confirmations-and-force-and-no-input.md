# 07 — Confirmations + `--force` + `--no-input`

**What to build:** `esl publish` asks for confirmation before pushing, and
`--force` skips that confirmation. `esl uninstall` accepts `--force` to skip
confirmation. A global `--no-input` disables every prompt and fails fast when
input is required. Prompts only fire when running in an interactive terminal.

**Blocked by:** 04 — Publish without embedding token in the remote.

**Status:** ready-for-agent

- [ ] `esl publish` asks for confirmation before pushing.
- [ ] `--force` skips confirmation for `publish` and `uninstall`.
- [ ] A global `--no-input` disables all prompts and fails fast when input is
  required.
- [ ] Prompts only fire when running in an interactive terminal.

