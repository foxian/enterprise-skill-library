# Local Skill Source Update Workflows Spec

## Problem Statement

Users who install skills from a Local Skill Source currently need to remember
and pass the original local directory path again when they want to refresh the
installed copy. This is inconvenient because ESL already records `file:` sources
in `.skills.json`.

The behavior is also inconsistent for global installs: `esl install
<local-path> --global` should mean "install this local skill into the global
skill store", but the local path install flow can behave like a project install.

## Solution

ESL should treat `file:` entries in skill manifests as durable Local Skill Source
references.

Project updates should re-sync local skills from the `file:` source stored in
the project `.skills.json`. Global updates should read the global manifest and
re-sync global local skills from their recorded Local Skill Source.

Global local installs should install into the global skill store and write
global manifest metadata, without touching the current project's `.skills/` or
`.skills.json`.

## User Stories

1. As a skill user, I want `esl update` to refresh local `file:` skills, so that
   I do not need to find and pass the local folder path again.
2. As a skill user, I want `esl update @local/foo` to refresh only that local
   skill, so that I can update one dependency deliberately.
3. As a skill user, I want `esl install ./foo --global` to install into my
   global skill store, so that `--global` behaves consistently.
4. As a skill user, I want global installs to maintain a global manifest, so
   that future global updates know where skills came from.
5. As a skill developer, I want my Local Skill Source path recorded once, so
   that iteration is fast.
6. As a CLI user, I want project and global manifests to be separate, so that
   project dependencies do not leak into global state.
7. As a CLI user, I want missing Local Skill Sources to fail clearly, so that I
   know to reinstall from the new path.

## Implementation Decisions

- Define Local Skill Source as the original local directory where a skill is
  authored or maintained before installation.
- Keep project dependency declarations in project `.skills.json`.
- Use a global manifest under the global ESL store for global dependencies.
- `install <local-path> --global` installs into the global skill store and
  records a `file:` source in the global manifest.
- `update` processes project manifest entries, including `file:` sources.
- `update --global` processes the global manifest, including `file:` sources.
- Do not put project manifests inside `.skills/`; `.skills/` remains an install
  result that can be rebuilt.

## Testing Decisions

- Test at the command execution seam rather than internal helpers.
- Use `executeInstall` to verify local path global installs write global state
  and avoid project state.
- Use `executeUpdate` to verify project `file:` dependencies re-sync from Local
  Skill Source.
- Use `executeUpdate` with global mode to verify global `file:` dependencies
  re-sync from the global manifest.
- Preserve existing registry and server update coverage.
- Good tests should assert user-visible command behavior and avoid coupling to
  helper implementation details.

## Out of Scope

- Automatic filesystem search for moved Local Skill Sources.
- Publishing `@local/*` skills.
- Changing Skill Identity or Namespace rules.
- Adding a new command such as `reinstall`.

## Further Notes

The user confirmed that the command-level seam is the right test seam. The
expected UX is that `install <path>` establishes or repairs the Local Skill
Source, while `update` refreshes from the recorded source.

This spec was saved locally because this project is not hosted on GitHub and the
GitHub CLI issue tracker flow is unavailable in the current environment.
