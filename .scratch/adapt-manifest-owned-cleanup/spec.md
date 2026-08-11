# Adapt Manifest Owned Cleanup

Status: ready-for-agent

## Problem Statement

ESL currently treats AI tool skill directories as if they are ESL-owned outputs. During adapt, tool directories such as `.agents/skills`, `.claude/skills`, and `.trae/skills` are cleaned before current skills are copied back. That behavior is unsafe because those directories are shared by AI tools and may contain user-installed skills, plugin-managed skills, or other non-ESL content.

The user experienced this failure mode directly: an adapt-related test run reached the real global Codex skills directory and cleared user skills. The project needs an ownership-based cleanup model that lets ESL maintain its own adapted outputs without deleting unrelated tool skills.

## Solution

ESL should stop cleaning whole AI tool skill directories during normal adapt. Instead, each source store owns an Adapt Manifest that records the adapted outputs ESL last generated:

- Project store: `.skills/.esl-adapt-manifest.json`
- Global store: `.skill-library/.esl-adapt-manifest.json`

Normal `adapt` should only upsert current store skills into AI tool directories and update the Adapt Manifest. It should not delete stale output by default. Stale output cleanup should require an explicit prune operation, such as `esl adapt --prune`.

Prune should only consider entries recorded in the Adapt Manifest. Before deleting any target directory, ESL must verify that the target still matches the recorded Skill Identity or Adapted Skill Display Name. If verification fails, ESL must skip that directory and report it instead of deleting it.

If an adapt target directory already exists but is not recorded in the Adapt Manifest, ESL may adopt and overwrite it only when the target identity matches the current Skill Identity. If the identity does not match, ESL should report the conflict and leave the directory untouched.

## User Stories

1. As a Codex user, I want `esl adapt` to leave non-ESL skills in `.agents/skills` untouched, so that my manually installed skills are not deleted.
2. As a Claude user, I want `esl adapt` to leave non-ESL skills in `.claude/skills` untouched, so that project adaptation does not destroy unrelated tool state.
3. As a Trae user, I want `esl adapt` to leave non-ESL skills in `.trae/skills` untouched, so that ESL does not assume ownership of shared tool directories.
4. As a project user, I want normal adapt to upsert current project skills, so that installed skills are still generated into tool directories.
5. As a project user, I want normal adapt not to delete stale output by default, so that path mistakes or empty stores cannot cause destructive cleanup.
6. As a project user, I want stale output cleanup to require `--prune`, so that deletion is an explicit choice.
7. As a project user, I want project adapted outputs recorded in `.skills/.esl-adapt-manifest.json`, so that ESL knows which tool outputs it owns.
8. As a global user, I want global adapted outputs recorded in `.skill-library/.esl-adapt-manifest.json`, so that global adapt ownership is tracked separately from project adapt ownership.
9. As a project user, I want prune to delete only manifest-recorded stale output, so that unrelated directories are never inferred as ESL-owned by name alone.
10. As a project user, I want prune to verify identity before deleting, so that a directory reused by a user is not removed just because a stale manifest mentions that path.
11. As a project user, I want prune to skip and report verification failures, so that I can inspect conflicts manually.
12. As a project user, I want an empty `.skills` store to produce `0 synced` without deleting tool skills, so that a misconfigured project root is safe.
13. As a global user, I want an empty `.skill-library` store to produce `0 synced` without deleting global tool skills, so that global misconfiguration is safe.
14. As a project user, I want an existing unmanifested target directory to be adopted only when its identity matches, so that legacy ESL output can be brought under manifest ownership safely.
15. As a project user, I want an existing unmanifested target directory with a different identity to be left untouched, so that ESL does not overwrite a user skill.
16. As a CLI user, I want adapt output to distinguish synced, pruned, adopted, skipped, and conflicted outputs, so that I can understand what happened.
17. As a maintainer, I want the new behavior tested through adapt entry points, so that tests protect against whole-directory deletion regressions.
18. As a maintainer, I want the code to use the domain terms Skill Identity, Adapted Skill Directory Name, Adapted Skill Display Name, and Adapt Manifest consistently, so that ownership semantics stay clear.
19. As a maintainer, I want tests to prove adapt does not touch non-ESL directories, so that the previous data-loss failure mode cannot silently return.
20. As a maintainer, I want CLI `--prune` to be covered separately from core deletion behavior, so that command parsing and output stay correct without duplicating core tests.

## Implementation Decisions

- AI tool skill directories are shared tool directories, not ESL-owned directories.
- ESL ownership is recorded only in the Adapt Manifest stored in the source store.
- Project Adapt Manifest path is `.skills/.esl-adapt-manifest.json`.
- Global Adapt Manifest path is `.skill-library/.esl-adapt-manifest.json`.
- Normal adapt must not call a whole-directory clean operation for AI tool skills directories.
- Normal adapt upserts current store skills and writes a fresh Adapt Manifest record for generated outputs.
- Normal adapt does not delete stale output.
- Prune is explicit and should be exposed through CLI, for example `esl adapt --prune`.
- Prune only evaluates stale outputs from the Adapt Manifest.
- Prune deletes a stale output only when the target still verifies as the recorded Skill Identity or Adapted Skill Display Name.
- Prune skips and reports entries whose target directory fails identity verification.
- If an adapted target exists but is not in the Adapt Manifest, ESL may adopt it only when identity verification matches the current Skill Identity.
- If an adapted target exists, is not in the Adapt Manifest, and identity verification does not match, ESL must report a conflict and leave it untouched.
- An empty source store is safe by default and produces zero synced skills without deleting any AI tool directory.
- The Adapt Manifest should record enough information to diagnose and prune safely: tool name, Skill Identity, Adapted Skill Directory Name, Adapted Skill Display Name, and target directory.
- The existing namespace-aware adapted output behavior remains in force: directory names use `namespace_skill-name`, and adapted `SKILL.md` names use `namespace:skill-name`.
- The ADR `Adapt manifest owns AI tool outputs` is accepted context for this feature.

## Testing Decisions

- The primary test seam is `adaptProject` and `adaptGlobal` external behavior.
- Tests should assert filesystem outcomes and returned results rather than private helper details.
- Project adapt tests should prove normal adapt does not delete an unrelated directory in a tool skills directory.
- Global adapt tests should prove normal adapt does not delete an unrelated directory in a global tool skills directory.
- Project adapt tests should prove an Adapt Manifest is written to the project source store.
- Global adapt tests should prove an Adapt Manifest is written to the global source store.
- Tests should cover empty store behavior: zero synced and no deletion.
- Tests should cover prune deleting a manifest-recorded stale output only after identity verification succeeds.
- Tests should cover prune skipping a stale output when identity verification fails.
- Tests should cover adoption of an unmanifested target when identity matches the current Skill Identity.
- Tests should cover conflict behavior when an unmanifested target identity does not match.
- CLI tests should cover `--prune` option parsing and output categories without re-testing every core deletion case.
- Prior art for tests includes existing adapt engine tests, tool adapter tests, import auto-adapt tests, install auto-adapt tests, and CLI adapt formatting tests.
- Final verification should run `npm test` and `npm run build`.

## Out of Scope

- Restoring previously deleted user skills.
- Adding marker files inside adapted tool skill directories.
- Moving ESL adapted outputs into a nested subdirectory that AI tools may not scan.
- Changing Skill Identity, Adapted Skill Directory Name, or Adapted Skill Display Name formats.
- Supporting symlink, junction, hard-link, or live-view adapted outputs.
- Bidirectional synchronization from AI tool directories back into ESL stores.
- Automatically deleting stale output during normal adapt.
- Treating directory naming conventions alone as proof of ESL ownership.

## Further Notes

This feature is a safety correction. The previous clean-first strategy made sense when tool skill directories were treated as generated output, but the actual domain model is different: those directories are shared by AI tools. The Adapt Manifest gives ESL a source-store ownership record without adding marker files to tool directories or claiming ownership over the whole tool skills root.
