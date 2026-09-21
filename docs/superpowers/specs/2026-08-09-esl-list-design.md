# Design: `esl list` Command

**Date:** 2026-08-09
**Status:** Approved

## Summary

Add an `esl list` (alias `ls`) command that displays installed skills for the
current project or the global store.

## Data Source Strategy

1. **Primary:** Read `.skills-lock.json` — provides exact version, source type
   (`registry` | `local`), and integrity hash.
2. **Fallback:** If no lockfile exists, scan the `.skills/` directory and read
   each `skill.json` for version metadata.
3. For `--global`, read from `~/.skill-library/skills/` using the same strategy.

## CLI Interface

```
esl list                # project skills
esl list --global       # global skills
esl list --json         # machine-readable JSON
```

Alias: `ls`

## Output Format

### Human-readable (default)

```
Project skills (3 installed):
  @cnfox/code-review       v1.2.0   (registry)
  @frontend/react-rules    v2.0.1   (registry)
  @local/my-helper         v0.1.0   (local)
```

When no skills are installed:

```
No skills installed in this project.
```

### JSON (`--json`)

```json
[
  { "name": "@cnfox/code-review", "version": "1.2.0", "source": "registry" },
  { "name": "@frontend/react-rules", "version": "2.0.1", "source": "registry" },
  { "name": "@local/my-helper", "version": "0.1.0", "source": "local" }
]
```

## Code Structure

### `@esl/core`

New export in `src/store/skills-json.ts`:

```ts
export interface SkillListEntry {
  name: string;
  version: string;
  source: 'registry' | 'local';
}

export async function listSkills(projectRoot: string): Promise<SkillListEntry[]>
```

### `@esl/cli`

New file `src/commands/list.ts`:

```ts
export async function executeList(options: ListOptions): Promise<SkillListEntry[]>
```

### `src/bin/esl.ts`

Register `list` command with alias `ls`.

## Tests

- `list.test.ts`: lockfile present → returns entries; no lockfile → scans dir;
  empty project → returns []; `--global` → reads global store.
- `bin.test.ts`: update command list to include `list`.
