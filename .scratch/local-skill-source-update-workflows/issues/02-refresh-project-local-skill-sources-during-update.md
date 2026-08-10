# 02 - Refresh project Local Skill Sources during update

**What to build:** `esl update` and `esl update <skill>` re-sync project `file:`
dependencies from their recorded Local Skill Source, so the user does not need
to find and pass the local folder path again.

**Blocked by:** None - can start immediately.

**Status:** ready-for-agent

- [ ] Updating all project skills includes dependencies whose manifest specifier
      starts with `file:`.
- [ ] Updating a specific project skill works when that skill is backed by a
      Local Skill Source.
- [ ] The installed project skill copy is refreshed from the recorded Local Skill
      Source.
- [ ] Registry-backed project update behavior continues to work.
- [ ] A missing or invalid Local Skill Source fails clearly instead of silently
      skipping the dependency.
