# 09 — Print status before long operations

**What to build:** `install`, `update`, and `source` print something
immediately before their Git operations so the CLI never looks hung. The
status messaging goes to stderr so it does not break piping on stdout.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `esl install` prints something immediately before cloning.
- [ ] `esl update` and `esl source` print something immediately before their
  Git operations.
- [ ] Status messaging goes to stderr so it does not break stdout piping.

