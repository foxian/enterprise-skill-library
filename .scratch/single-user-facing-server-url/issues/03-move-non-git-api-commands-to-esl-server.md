# 03 — Move Non-Git API Commands To ESL Server

**What to build:** Commands that only call the Registry API use the saved ESL Server URL or explicit `--server`, so search, info, and administration workflows no longer require separate API address vocabulary.

**Blocked by:** 02 — Teach CLI Login To Use ESL Server.

**Status:** resolved

- [ ] Search and info commands call `/api` routes on the configured ESL Server.
- [ ] Administration commands call `/api` routes on the configured ESL Server.
- [ ] Explicit `--server` overrides the saved server setting for the command being run.
- [ ] Missing server configuration produces a clear user-facing error.
- [ ] Command help and examples for these commands use `--server` vocabulary.
- [ ] CLI command tests cover saved server config and explicit server override behavior.
