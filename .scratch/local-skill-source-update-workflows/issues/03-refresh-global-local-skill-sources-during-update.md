# 03 - Refresh global Local Skill Sources during update

**What to build:** `esl update --global` reads the global manifest and re-syncs
global `file:` dependencies from their recorded Local Skill Source.

**Blocked by:** 01 - Support global installs from a Local Skill Source.

**Status:** ready-for-agent

- [ ] Global update reads global dependency state rather than the current
      project's dependency manifest.
- [ ] Global update includes dependencies whose manifest specifier starts with
      `file:`.
- [ ] The installed global skill copy is refreshed from the recorded Local Skill
      Source.
- [ ] Global update does not create or update project install state.
- [ ] Registry-backed global update behavior remains compatible with the global
      manifest.
