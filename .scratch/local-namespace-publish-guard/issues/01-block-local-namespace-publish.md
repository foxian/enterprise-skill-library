# 01 - Block publishing `@local/*` skills

**What to build:** When a user runs `esl publish` from a skill whose identity
uses the `@local` namespace, the CLI rejects the publish attempt before any
server request or Git command happens. The error should tell the user that
`@local/*` skills are local or draft skills and must be renamed to a stable
namespace before publishing.

**Blocked by:** None - can start immediately.

**Status:** ready-for-agent

- [ ] `esl publish` rejects a valid `@local/*` skill before making any API request.
- [ ] `esl publish` rejects a valid `@local/*` skill before executing any Git command.
- [ ] The rejection message uses the user-facing term `namespace`.
- [ ] The rejection message tells the user to rename the skill to a stable namespace before publishing.
- [ ] Existing validation failures still surface normally for invalid skill packages.
