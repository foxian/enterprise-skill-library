# 06 — Central error handling + `--debug` + SIGINT

**What to build:** All failures route through one error path that prints a
single human-readable line plus a suggestion, with no stack trace by default.
Passing a debug flag reveals full stack traces on stderr. Failures exit
non-zero, and hitting Ctrl-C stops the CLI immediately.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Errors print as a single human-readable line with a suggestion, without a
  stack trace by default.
- [ ] Passing the debug flag prints full stack traces to stderr.
- [ ] Failures exit with a non-zero code.
- [ ] Ctrl-C stops the CLI immediately.

