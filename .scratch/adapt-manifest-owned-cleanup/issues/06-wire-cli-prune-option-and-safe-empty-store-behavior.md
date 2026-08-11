# 06 — Wire CLI prune option and safe empty-store behavior

**What to build:** The CLI should expose explicit prune behavior and preserve safe defaults. Users should be able to run normal adapt without deletion, or opt into stale cleanup with `--prune`.

**Blocked by:** 04 — Add explicit prune for manifest-owned stale output; 05 — Report skipped and conflicted cleanup outcomes.

**Status:** ready-for-agent

- [ ] `esl adapt --prune` invokes prune behavior.
- [ ] `esl adapt --global --prune` invokes global prune behavior.
- [ ] CLI output for empty stores reports zero synced without deletion.
- [ ] CLI parsing and output behavior remain in the CLI package.
- [ ] CLI tests cover prune option parsing and output categories.
