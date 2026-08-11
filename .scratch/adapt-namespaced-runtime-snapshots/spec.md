# Adapt Namespaced Runtime Snapshots

Status: ready-for-agent

## Problem Statement

ESL already models a Skill Identity as `@namespace/skill-name`, and installed skills live under namespace-aware stores such as project `.skills` and the global `.skill-library`. However, adapted AI tool directories currently use only the skill short name as the runtime directory name and preserve the short `SKILL.md` frontmatter name.

That means two skills with the same short name but different namespaces can collide when adapted into the same AI tool directory. It also means the AI tool may only see ambiguous short names, even though ESL knows the full Skill Identity. The user needs adapted skills to carry enough namespace information to prevent name collisions in AI tools while keeping ESL's store copy as the authoritative source.

## Solution

Adapted skills should be generated as copied runtime snapshots, not links. The project and global skill stores remain the authoritative sources. AI tool directories are derived outputs that `esl adapt` may delete and rebuild.

When adapting a skill, ESL should derive two namespace-aware runtime identities from the Skill Identity:

- The Adapted Skill Directory Name uses `namespace_skill-name`, such as `cnfox_code-review`.
- The Adapted Skill Display Name written into adapted `SKILL.md` frontmatter uses `namespace:skill-name`, such as `cnfox:code-review`.

The `local` namespace follows the same rule, so `@local/brainstorming` adapts to `local_brainstorming` with `name: local:brainstorming`. CLI output should show the mapping from Skill Identity to Adapted Skill Directory Name, for example `@cnfox/code-review -> cnfox_code-review`.

## User Stories

1. As a project user, I want `esl adapt` to preserve namespace information in AI tool directories, so that skills from different namespaces do not overwrite each other.
2. As a project user, I want `@alice/code-review` and `@bob/code-review` to adapt into different runtime directories, so that both can be installed at the same time.
3. As a project user, I want adapted directories to stay one level below the AI tool skills directory, so that tools that scan `skills/*/SKILL.md` continue to work.
4. As a project user, I want adapted directory names to use `namespace_skill-name`, so that the boundary between namespace and skill name is unambiguous.
5. As a project user, I want adapted `SKILL.md` names to use `namespace:skill-name`, so that the AI tool sees a namespace-qualified display name.
6. As a project user, I want local skills to use the same namespace rules as published skills, so that local skills also avoid short-name collisions.
7. As a project user, I want `.skills` and `.skill-library` to remain the authoritative source of installed skills, so that there is one clear place where ESL-managed source state lives.
8. As a project user, I want AI tool directories to be treated as derived outputs, so that running `esl adapt` produces a predictable runtime snapshot.
9. As a project user, I want `esl adapt` to copy skills rather than create links, so that changes to the store do not implicitly alter AI tool runtime state until adapt runs again.
10. As a project user, I want `esl adapt` to be able to rewrite adapted `SKILL.md` frontmatter, so that tool-specific identity rules can be applied without mutating the original local skill source.
11. As a project user, I want project-level adapt and global adapt to use the same naming rules, so that behavior is consistent across store scopes.
12. As a project user, I want CLI output to show both the Skill Identity and the Adapted Skill Directory Name, so that I can understand exactly what was generated.
13. As a project user, I want existing short-name skills to remain valid where appropriate, so that older skills are not unnecessarily broken by the new adapted naming behavior.
14. As a project maintainer, I want namespace-aware adapted output to be tested through the adapt command behavior, so that tests verify user-visible outcomes rather than internal helper details.
15. As a project maintainer, I want the implementation to leave import and install ownership clear, so that reusable logic remains in core and CLI behavior remains in the CLI package.
16. As a project maintainer, I want copied runtime snapshots instead of links, so that Windows symlink and junction behavior does not become part of the normal adapt contract.
17. As a project maintainer, I want tool-specific adapted rewriting to be possible, so that future tools can use different display-name constraints without changing ESL's store model.
18. As a project maintainer, I want adapted output to be safely deletable and rebuildable, so that clean adapt behavior remains simple and deterministic.

## Implementation Decisions

- `adapt` produces copied runtime snapshots. It does not create directory links, symlinks, junctions, or hard links as part of this feature.
- The project `.skills` store and the global `.skill-library` store are the authoritative sources for installed skills. AI tool skill directories are derived outputs.
- Adapted output may be deleted and rebuilt by `esl adapt`. Manual edits under AI tool adapted directories are outside the supported workflow.
- The Adapted Skill Directory Name is derived from the Skill Identity as `namespace_skill-name`.
- The Adapted Skill Display Name is derived from the Skill Identity as `namespace:skill-name`.
- The `local` namespace is not special-cased away. `@local/name` adapts with `local` in both the directory name and display name.
- Adapt should retain a one-level AI tool directory layout so tools that scan direct children of their skills directory continue to find skills.
- Adapt should allow tool-specific mutation of copied runtime files. The immediate required mutation is rewriting adapted `SKILL.md` frontmatter `name` to the Adapted Skill Display Name.
- Existing import and install behavior should continue to use Skill Identity for dependency records and store layout.
- CLI adapt output should expose a mapping from Skill Identity to Adapted Skill Directory Name, rather than only returning or printing the short skill name.
- Reusable derivation and adapted-copy behavior belong in core. CLI parsing, presentation, and exit behavior belong in the CLI package.
- The domain glossary already distinguishes Skill Identity, Adapted Skill Directory Name, and Adapted Skill Display Name; implementation should use that vocabulary consistently.

## Testing Decisions

- The primary test seam is the external behavior of project and global adapt. Tests should call the adapt entry points and assert the generated filesystem output.
- Tests should prefer behavior visible to callers: generated directory names, generated `SKILL.md` frontmatter, CLI output mappings, and collision avoidance.
- Tests should avoid over-specifying private helper implementations. If a helper is introduced to derive names or rewrite frontmatter, it should still be primarily covered through adapt behavior unless direct tests add clear value.
- Project adapt tests should cover a namespaced skill adapting to `namespace_skill-name` with adapted `SKILL.md` name `namespace:skill-name`.
- Project adapt tests should cover two skills with the same short name in different namespaces adapting without overwrite.
- Project adapt tests should cover `@local/skill-name` adapting with `local_skill-name` and `name: local:skill-name`.
- Global adapt tests should cover the same naming rules for `.skill-library` skills.
- CLI adapt tests should cover output that shows `@namespace/skill-name -> namespace_skill-name`.
- Existing import and install tests should be updated where their expectations mention adapted short-name directories.
- Existing validator tests should be adjusted only as needed to keep backward compatibility clear.
- Final verification should run the repository's standard checks: `npm test` and `npm run build`.

## Out of Scope

- Adding an `esl adapt --link` mode.
- Supporting symlink, junction, hard-link, or live-view adapt output.
- Bidirectional synchronization between AI tool directories and ESL stores.
- Preserving manual edits inside adapted AI tool directories.
- Changing the Skill Identity format from `@namespace/skill-name`.
- Changing the store layout for `.skills` or `.skill-library`.
- Publishing behavior changes unrelated to adapted runtime names.
- Adding new namespace characters or changing existing namespace validation rules.

## Further Notes

This feature is intended to make AI tool runtime state unambiguous while keeping the ESL domain model simple. The store copy is source state. Adapted tool directories are generated runtime snapshots. Directory names solve filesystem collisions; adapted display names solve AI tool identity and display collisions.
