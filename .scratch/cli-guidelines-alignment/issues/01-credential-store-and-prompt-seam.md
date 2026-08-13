# 01 — Credential store + prompt seam (expand)

**What to build:** Introduce a dedicated credentials file, readable only by its
owner, that can store a token separately from the general configuration, plus
an injectable prompt reader that hides input as the user types. This is the
"expand" step: the existing token handling in the general config keeps working
unchanged so nothing breaks, while the new seams become available for later
tickets to adopt.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A dedicated credentials file, separate from the general config, can be
  written and read back with owner-only (0600) permissions.
- [ ] An injectable prompt reader exists on the command-execution seam that
  hides echoed input, mirroring the existing `customFetch` injection pattern.
- [ ] Existing token handling in the general config still works unchanged.

