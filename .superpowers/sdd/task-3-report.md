# Task 3 Report: SKILL.md and Skill Directory Validation

## Status

DONE

## Scope

Implemented only the Task 3 `@esl/core` SKILL.md parsing and skill directory validation work:

- Added `validateSkillMd(content)` and `SkillMdMetadata` in `packages/core/src/skill/skill-md.ts`.
- Added `validateSkillDirectory(directory)` and `SkillDirectory` in `packages/core/src/skill/directory-validator.ts`.
- Re-exported both APIs from `packages/core/src/index.ts`.
- Added the specified tests in `packages/core/tests/skill-directory.test.ts`.

No local store, CLI init, validate command, version command, or CLI entrypoint work was implemented.

## TDD Evidence

Tests were added before production implementation.

RED command:

```text
npx vitest run packages/core/tests/skill-directory.test.ts
```

RED result:

```text
FAIL packages/core/tests/skill-directory.test.ts (4 tests | 4 failed)
validateSkillMd is not a function
validateSkillDirectory is not a function
```

The failure was expected because the new validators did not yet exist or export from `@esl/core`.

## Implementation

`validateSkillMd` now:

- Extracts YAML frontmatter delimited by `---`.
- Reports missing or invalid frontmatter.
- Validates lowercase hyphenated names up to 64 characters.
- Validates non-empty descriptions up to 1024 characters.

`validateSkillDirectory` now:

- Requires `skill.json` and `SKILL.md`.
- Validates `skill.json` through `validateSkillJson()`.
- Validates `SKILL.md` through `validateSkillMd()`.
- Reports `resources/` as deprecated.
- Ensures the SKILL.md name matches the `skill.json` name suffix using `parseSkillName()`.

## Verification

Focused Task 3 tests:

```text
npx vitest run packages/core/tests/skill-directory.test.ts
PASS
1 test file passed, 4 tests passed
```

Required build:

```text
npm run build --workspace @esl/core
PASS
```

Full existing core test suite:

```text
npx vitest run packages/core/tests
PASS
3 test files passed, 9 tests passed
```

`git diff --check` reported no whitespace errors.

## Self-Review

Reviewed the final diff and confirmed that changes are limited to the Task 3 files. Existing schema APIs and package conventions are reused. No concerns found in the implemented behavior.

The worktree contained pre-existing untracked `.superpowers/`, `node_modules/`, and `packages/core/dist/` artifacts. They were not included in the commit.

## Commit

```text
825b972 feat(core): validate runtime skill directories
```

## Review Fixes

Fixed the three Task 3 review findings:

- Added a regression test for a directory named `SKILL.md`; read failures now return a failed `ValidationResult` with the filesystem error instead of rejecting.
- Added a strict frontmatter regression test; `validateSkillMd()` now rejects unknown package metadata such as `author`, keeping `skill.json` metadata separate.
- Added a directory-name regression test; `validateSkillDirectory()` now requires the frontmatter name to match both the `skill.json` suffix and the containing directory name.

## Review Fix Verification

Focused tests:

```text
npx vitest run packages/core/tests/skill-directory.test.ts
PASS: 1 test file passed, 7 tests passed
```

Required build:

```text
npm run build --workspace @esl/core
PASS: tsc exited with code 0
```
