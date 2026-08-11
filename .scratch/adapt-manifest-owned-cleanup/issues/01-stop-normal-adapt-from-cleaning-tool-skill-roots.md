# 01 — Stop normal adapt from cleaning tool skill roots

**What to build:** Normal project and global adapt should stop treating AI tool skill directories as ESL-owned roots. Running adapt should still upsert current ESL skills into tool directories, but unrelated tool skill directories must survive untouched.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Project adapt does not delete unrelated directories in an AI tool skills directory.
- [ ] Global adapt does not delete unrelated directories in a global AI tool skills directory.
- [ ] Current ESL skills are still copied or updated during normal adapt.
- [ ] Empty project and global stores do not delete any AI tool skills.
- [ ] Normal adapt no longer depends on whole-directory clean behavior.
