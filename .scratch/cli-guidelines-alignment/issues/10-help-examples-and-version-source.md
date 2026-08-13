# 10 — Help examples + version from package manifest

**What to build:** Every command's help text includes one or two examples so
users can learn usage by copying. The version reported by `esl --version` comes
from the package manifest instead of a hardcoded literal, so it cannot drift
out of sync.

**Blocked by:** 03 — Migrate commands to the credential store; 05 — `info`/
`search` `--json`; 06 — Central error handling; 07 — Confirmations + `--force`
+ `--no-input`.

**Status:** ready-for-agent

- [ ] Each command's help includes at least one example.
- [ ] `esl --version` reports the version from the package manifest.
- [ ] The reported version cannot drift from the manifest.

