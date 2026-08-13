# 01 — Docker runtime bootstraps internal Gitea backend

**What to build:** The Docker runtime starts with Gitea already prepared as an internal ESL backend, so the user does not have to complete Gitea first-run setup by hand.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Gitea comes up in a usable initialized state on first launch.
- [ ] The runtime prepares the internal service administrator, bootstrap token, and default organization needed for ESL operations.

## Comments

The first implementation locks Gitea installation, disables public registration, accepts a configurable `ESL_BOOTSTRAP_ADMIN_TOKEN`, provisions Skill Users through Gitea once an admin token is configured, and exposes readiness for the configured repository owner organization. It does not yet create the Gitea service administrator, admin token, or default organization automatically.
