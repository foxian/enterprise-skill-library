# 02 - Document local namespace behavior

**What to build:** Users can discover that `@local` is reserved for local,
unpublished, or draft skills, and that `@local/*` must be renamed before
publishing. The documentation should align with the domain model language:
`namespace` is the stable identity segment, while creator, owner, and
maintainers are separate concepts.

**Blocked by:** None - can start immediately.

**Status:** ready-for-agent

- [ ] User-facing documentation explains that `@local/*` is for local or draft skills.
- [ ] User-facing documentation explains that `@local/*` cannot be published directly.
- [ ] User-facing documentation shows an example rename from `@local/*` to a stable namespace.
- [ ] Documentation uses `namespace` for the user-facing concept and avoids presenting it as ownership.
- [ ] Documentation remains consistent with the local namespace ADR and glossary.
