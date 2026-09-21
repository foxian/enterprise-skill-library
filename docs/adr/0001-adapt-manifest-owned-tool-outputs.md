# Adapt manifest owns AI tool outputs

AI tool skill directories such as `.agents/skills`, `.claude/skills`, and
`.trae/skills` are shared tool directories, not ESL-owned directories. ESL will
record adapted outputs in an Adapt Manifest in the source store and will not
delete tool directories by default; stale output cleanup requires an explicit
prune operation and must verify that the target still matches the recorded Skill
Identity or Adapted Skill Display Name before deletion.

This avoids repeating the failure mode where an adapt run clears user-installed
or otherwise non-ESL skill directories while still letting ESL maintain its own
generated adapted outputs.
