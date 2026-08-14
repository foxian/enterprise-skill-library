# 07 — Expose One Local Docker ESL Server URL

**What to build:** The default local Docker runtime exposes one ESL Server URL that routes `/api` to the Registry API and `/git` to the Git Backend, while direct Gitea exposure moves to a debug override.

**Blocked by:** 04 — Return Clean Clone URLs From ESL Server APIs; 05 — Move Git Workflow Commands To Clone URLs.

**Status:** resolved

- [ ] Default Docker startup exposes a single user-facing ESL Server port.
- [ ] Requests under `/api` reach the ESL Server API routes.
- [ ] Git HTTP traffic under `/git` reaches the Git Backend.
- [ ] Direct Gitea host-port exposure is absent from the default runtime.
- [ ] A debug override can expose Gitea directly for diagnostics or recovery.
- [ ] A fresh-volume Docker smoke check can authenticate and perform an API-backed CLI workflow through the single ESL Server URL.
