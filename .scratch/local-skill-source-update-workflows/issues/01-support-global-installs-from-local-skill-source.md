# 01 - Support global installs from a Local Skill Source

**What to build:** `esl install <local-path> --global` installs the skill into
the global skill store, records the Local Skill Source in the global manifest,
and leaves the current project's installed skills and dependency manifest
unchanged.

**Blocked by:** None - can start immediately.

**Status:** ready-for-agent

- [ ] Installing a local skill with `--global` writes the installed copy to the
      global skill store.
- [ ] The global manifest records the skill's `file:` Local Skill Source.
- [ ] The current project's `.skills/` install result is not created or updated
      by the global install.
- [ ] The current project's dependency manifest is not changed by the global
      install.
- [ ] Existing registry-backed global install behavior continues to work.
