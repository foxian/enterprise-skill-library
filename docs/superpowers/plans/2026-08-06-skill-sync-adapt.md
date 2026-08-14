# Skill Sync & Adapt Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement project-level skill dependency management, multi-tool adapt engine, and full lifecycle commands (install rework, adapt, update, clone, uninstall).

**Architecture:** Skills are installed as read-only copies into `.skills/`, tracked by `.skills.json` + `.skills-lock.json`. The adapt engine copies skills from `.skills/` to each AI tool's directory (`.claude/skills/`, `.agents/skills/`, `.trae/skills/`). All operations use file copying — no symlinks.

**Tech Stack:** TypeScript, Node.js `fs/promises`, vitest, commander, zod

## Global Constraints

- Keep reusable logic in `packages/core`; keep CLI parsing, output, and exit behavior in `packages/cli`.
- Verify changes with `npm test` and `npm run build`.
- All new modules use ESM (`import`/`export`), file extensions end in `.js` for imports.
- Follow existing code style: explicit return types, async/await, descriptive error messages.
- All file copy operations exclude `.git/` directories.
- Copied files are set to read-only mode (`0o444`).

---

### Task 1: File Copy Utilities

**Files:**
- Create: `packages/core/src/store/file-copy.ts`
- Create: `packages/core/tests/file-copy.test.ts`

**Interfaces:**
- Consumes: nothing (foundational)
- Produces:
  - `copySkillDirectory(source: string, target: string): Promise<void>` — recursively copies a directory, excluding `.git/`, and sets all files to read-only
  - `removeDirectory(target: string): Promise<void>` — removes a directory recursively (wrapper for `fs.rm`)

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/tests/file-copy.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copySkillDirectory, removeDirectory } from '../src/store/file-copy.js';

describe('copySkillDirectory', () => {
  let tmpDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-copy-'));
    srcDir = path.join(tmpDir, 'source');
    destDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(srcDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies files and subdirectories', async () => {
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Hello');
    fs.mkdirSync(path.join(srcDir, 'scripts'));
    fs.writeFileSync(path.join(srcDir, 'scripts', 'run.sh'), '#!/bin/bash');

    await copySkillDirectory(srcDir, destDir);

    expect(fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf8')).toBe('# Hello');
    expect(fs.readFileSync(path.join(destDir, 'scripts', 'run.sh'), 'utf8')).toBe('#!/bin/bash');
  });

  it('excludes .git directory', async () => {
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Hello');
    fs.mkdirSync(path.join(srcDir, '.git'));
    fs.writeFileSync(path.join(srcDir, '.git', 'HEAD'), 'ref: refs/heads/main');

    await copySkillDirectory(srcDir, destDir);

    expect(fs.existsSync(path.join(destDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, '.git'))).toBe(false);
  });

  it('sets copied files to read-only', async () => {
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Hello');

    await copySkillDirectory(srcDir, destDir);

    const stat = fs.statSync(path.join(destDir, 'SKILL.md'));
    // On Windows, check that the readonly flag is set
    if (process.platform === 'win32') {
      // Windows doesn't support Unix permissions the same way; just check the file exists
      expect(fs.existsSync(path.join(destDir, 'SKILL.md'))).toBe(true);
    } else {
      // eslint-disable-next-line no-bitwise
      expect(stat.mode & 0o222).toBe(0); // no write bits
    }
  });

  it('overwrites existing destination', async () => {
    fs.mkdirSync(destDir);
    fs.writeFileSync(path.join(destDir, 'old-file.txt'), 'old');

    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# New');

    await copySkillDirectory(srcDir, destDir);

    expect(fs.existsSync(path.join(destDir, 'old-file.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf8')).toBe('# New');
  });
});

describe('removeDirectory', () => {
  it('removes a directory recursively', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-rm-'));
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');

    await removeDirectory(tmpDir);

    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  it('does not throw if directory does not exist', async () => {
    await expect(removeDirectory('/nonexistent/path/xyz')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/file-copy.test.ts`
Expected: FAIL — module `../src/store/file-copy.js` not found

- [ ] **Step 3: Implement file copy utilities**

```typescript
// packages/core/src/store/file-copy.ts
import fs from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRS = new Set(['.git']);

async function copyRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      await copyRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      try {
        await fs.chmod(destPath, 0o444);
      } catch {
        // On Windows, chmod may not fully work; ignore errors
      }
    }
  }
}

export async function copySkillDirectory(source: string, target: string): Promise<void> {
  await removeDirectory(target);
  await copyRecursive(source, target);
}

export async function removeDirectory(target: string): Promise<void> {
  try {
    // Make files writable before removing (they may be read-only)
    await makeWritableRecursive(target);
  } catch {
    // Directory may not exist
  }
  await fs.rm(target, { recursive: true, force: true });
}

async function makeWritableRecursive(dir: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await makeWritableRecursive(fullPath);
    } else {
      try {
        await fs.chmod(fullPath, 0o666);
      } catch {
        // Ignore
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/file-copy.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Export from core index**

Add to `packages/core/src/index.ts` (line 8, before the closing line):

```typescript
export * from './store/file-copy.js';
```

- [ ] **Step 6: Run full test suite and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/core/src/store/file-copy.ts packages/core/tests/file-copy.test.ts packages/core/src/index.ts
git commit -m "feat(core): add file copy utilities with .git exclusion and read-only support"
```

---

### Task 2: Skills JSON Dependency Management

**Files:**
- Create: `packages/core/src/store/skills-json.ts`
- Create: `packages/core/tests/skills-json.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SkillsJson` type — `{ skills: Record<string, string>; tools?: string[] }`
  - `SkillsLockJson` type — `{ lockfileVersion: number; skills: Record<string, SkillsLockEntry> }`
  - `SkillsLockEntry` type — `{ version: string; resolved: string; integrity: string }`
  - `loadSkillsJson(projectRoot: string): Promise<SkillsJson>` — reads `.skills.json`, returns empty default if missing
  - `saveSkillsJson(projectRoot: string, data: SkillsJson): Promise<void>`
  - `loadSkillsLock(projectRoot: string): Promise<SkillsLockJson>` — reads `.skills-lock.json`, returns empty default if missing
  - `saveSkillsLock(projectRoot: string, data: SkillsLockJson): Promise<void>`
  - `addSkillDependency(projectRoot: string, name: string, specifier: string): Promise<void>` — adds/updates one entry in `.skills.json`
  - `removeSkillDependency(projectRoot: string, name: string): Promise<void>` — removes one entry from both files
  - `addLockEntry(projectRoot: string, name: string, entry: SkillsLockEntry): Promise<void>`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/tests/skills-json.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addLockEntry,
  addSkillDependency,
  loadSkillsJson,
  loadSkillsLock,
  removeSkillDependency,
  saveSkillsJson
} from '../src/store/skills-json.js';

describe('skills-json', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-skills-json-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty defaults when files do not exist', async () => {
    const skills = await loadSkillsJson(tmpDir);
    expect(skills).toEqual({ skills: {} });

    const lock = await loadSkillsLock(tmpDir);
    expect(lock).toEqual({ lockfileVersion: 1, skills: {} });
  });

  it('saves and loads .skills.json', async () => {
    const data = { skills: { '@scope/skill-a': '^1.0.0' }, tools: ['claude'] };
    await saveSkillsJson(tmpDir, data);

    const loaded = await loadSkillsJson(tmpDir);
    expect(loaded).toEqual(data);
  });

  it('adds a skill dependency', async () => {
    await addSkillDependency(tmpDir, '@scope/skill-a', '^1.0.0');
    await addSkillDependency(tmpDir, '@scope/skill-b', 'file:../my-skill');

    const loaded = await loadSkillsJson(tmpDir);
    expect(loaded.skills).toEqual({
      '@scope/skill-a': '^1.0.0',
      '@scope/skill-b': 'file:../my-skill'
    });
  });

  it('removes a skill dependency from both files', async () => {
    await addSkillDependency(tmpDir, '@scope/skill-a', '^1.0.0');
    await addLockEntry(tmpDir, '@scope/skill-a', {
      version: '1.0.0',
      resolved: 'esl-skills/scope_skill-a',
      integrity: 'sha256-abc'
    });

    await removeSkillDependency(tmpDir, '@scope/skill-a');

    const skills = await loadSkillsJson(tmpDir);
    expect(skills.skills['@scope/skill-a']).toBeUndefined();

    const lock = await loadSkillsLock(tmpDir);
    expect(lock.skills['@scope/skill-a']).toBeUndefined();
  });

  it('adds a lock entry', async () => {
    await addLockEntry(tmpDir, '@scope/skill-a', {
      version: '1.2.3',
      resolved: 'esl-skills/scope_skill-a',
      integrity: 'sha256-xyz'
    });

    const lock = await loadSkillsLock(tmpDir);
    expect(lock.skills['@scope/skill-a']).toEqual({
      version: '1.2.3',
      resolved: 'esl-skills/scope_skill-a',
      integrity: 'sha256-xyz'
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/skills-json.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement skills-json module**

```typescript
// packages/core/src/store/skills-json.ts
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SkillsJson {
  skills: Record<string, string>;
  tools?: string[];
}

export interface SkillsLockEntry {
  version: string;
  resolved: string;
  integrity: string;
}

export interface SkillsLockJson {
  lockfileVersion: number;
  skills: Record<string, SkillsLockEntry>;
}

const SKILLS_JSON = '.skills.json';
const SKILLS_LOCK_JSON = '.skills-lock.json';

function defaultSkillsJson(): SkillsJson {
  return { skills: {} };
}

function defaultSkillsLock(): SkillsLockJson {
  return { lockfileVersion: 1, skills: {} };
}

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function loadSkillsJson(projectRoot: string): Promise<SkillsJson> {
  return readJsonFile(path.join(projectRoot, SKILLS_JSON), defaultSkillsJson());
}

export async function saveSkillsJson(projectRoot: string, data: SkillsJson): Promise<void> {
  await writeJsonFile(path.join(projectRoot, SKILLS_JSON), data);
}

export async function loadSkillsLock(projectRoot: string): Promise<SkillsLockJson> {
  return readJsonFile(path.join(projectRoot, SKILLS_LOCK_JSON), defaultSkillsLock());
}

export async function saveSkillsLock(projectRoot: string, data: SkillsLockJson): Promise<void> {
  await writeJsonFile(path.join(projectRoot, SKILLS_LOCK_JSON), data);
}

export async function addSkillDependency(
  projectRoot: string,
  name: string,
  specifier: string
): Promise<void> {
  const data = await loadSkillsJson(projectRoot);
  data.skills[name] = specifier;
  await saveSkillsJson(projectRoot, data);
}

export async function removeSkillDependency(projectRoot: string, name: string): Promise<void> {
  const skillsData = await loadSkillsJson(projectRoot);
  delete skillsData.skills[name];
  await saveSkillsJson(projectRoot, skillsData);

  const lockData = await loadSkillsLock(projectRoot);
  delete lockData.skills[name];
  await saveSkillsLock(projectRoot, lockData);
}

export async function addLockEntry(
  projectRoot: string,
  name: string,
  entry: SkillsLockEntry
): Promise<void> {
  const data = await loadSkillsLock(projectRoot);
  data.skills[name] = entry;
  await saveSkillsLock(projectRoot, data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/skills-json.test.ts`
Expected: PASS

- [ ] **Step 5: Export from core index**

Add to `packages/core/src/index.ts`:

```typescript
export * from './store/skills-json.js';
```

- [ ] **Step 6: Run full test suite and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/core/src/store/skills-json.ts packages/core/tests/skills-json.test.ts packages/core/src/index.ts
git commit -m "feat(core): add .skills.json and .skills-lock.json dependency management"
```

---

### Task 3: ToolAdapter Interface and Implementations

**Files:**
- Create: `packages/core/src/adapt/tool-adapter.ts`
- Create: `packages/core/src/adapt/claude-adapter.ts`
- Create: `packages/core/src/adapt/codex-adapter.ts`
- Create: `packages/core/src/adapt/trae-adapter.ts`
- Create: `packages/core/src/adapt/index.ts`
- Create: `packages/core/tests/tool-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `copySkillDirectory(source, target)` from Task 1
  - `removeDirectory(target)` from Task 1
- Produces:
  - `ToolAdapter` interface — `{ name: string; projectDir(root: string): string; globalDir(): string; adapt(skillSourceDir: string, skillName: string, targetBaseDir: string): Promise<void>; clean(targetBaseDir: string): Promise<void> }`
  - `ClaudeAdapter` class implementing `ToolAdapter`
  - `CodexAdapter` class implementing `ToolAdapter`
  - `TraeAdapter` class implementing `ToolAdapter`
  - `getAdapter(name: string): ToolAdapter` — factory function
  - `SUPPORTED_TOOLS: string[]` — `['claude', 'codex', 'trae']`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/tests/tool-adapter.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeAdapter,
  CodexAdapter,
  TraeAdapter,
  getAdapter,
  SUPPORTED_TOOLS
} from '../src/adapt/index.js';

describe('ToolAdapter implementations', () => {
  let tmpDir: string;
  let srcDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapter-'));
    srcDir = path.join(tmpDir, 'source-skill');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Test Skill');
    fs.mkdirSync(path.join(srcDir, 'scripts'));
    fs.writeFileSync(path.join(srcDir, 'scripts', 'run.sh'), '#!/bin/bash');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ClaudeAdapter targets .claude/skills/', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.name).toBe('claude');
    expect(adapter.projectDir(tmpDir)).toBe(path.join(tmpDir, '.claude', 'skills'));
  });

  it('CodexAdapter targets .agents/skills/', () => {
    const adapter = new CodexAdapter();
    expect(adapter.name).toBe('codex');
    expect(adapter.projectDir(tmpDir)).toBe(path.join(tmpDir, '.agents', 'skills'));
  });

  it('TraeAdapter targets .trae/skills/', () => {
    const adapter = new TraeAdapter();
    expect(adapter.name).toBe('trae');
    expect(adapter.projectDir(tmpDir)).toBe(path.join(tmpDir, '.trae', 'skills'));
  });

  it('adapt copies skill to target directory', async () => {
    const adapter = new ClaudeAdapter();
    const targetBase = path.join(tmpDir, '.claude', 'skills');

    await adapter.adapt(srcDir, 'my-skill', targetBase);

    expect(fs.readFileSync(path.join(targetBase, 'my-skill', 'SKILL.md'), 'utf8')).toBe('# Test Skill');
    expect(fs.readFileSync(path.join(targetBase, 'my-skill', 'scripts', 'run.sh'), 'utf8')).toBe('#!/bin/bash');
  });

  it('clean removes all contents from target base directory', async () => {
    const adapter = new ClaudeAdapter();
    const targetBase = path.join(tmpDir, '.claude', 'skills');
    await adapter.adapt(srcDir, 'my-skill', targetBase);

    await adapter.clean(targetBase);

    expect(fs.existsSync(targetBase)).toBe(false);
  });

  it('getAdapter returns correct adapter by name', () => {
    expect(getAdapter('claude')).toBeInstanceOf(ClaudeAdapter);
    expect(getAdapter('codex')).toBeInstanceOf(CodexAdapter);
    expect(getAdapter('trae')).toBeInstanceOf(TraeAdapter);
  });

  it('getAdapter throws for unknown tool', () => {
    expect(() => getAdapter('unknown')).toThrow('Unknown tool: unknown');
  });

  it('exports SUPPORTED_TOOLS', () => {
    expect(SUPPORTED_TOOLS).toEqual(['claude', 'codex', 'trae']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/tool-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ToolAdapter interface**

```typescript
// packages/core/src/adapt/tool-adapter.ts
export interface ToolAdapter {
  name: string;
  projectDir(root: string): string;
  globalDir(): string;
  adapt(skillSourceDir: string, skillName: string, targetBaseDir: string): Promise<void>;
  clean(targetBaseDir: string): Promise<void>;
}
```

- [ ] **Step 4: Implement Claude adapter**

```typescript
// packages/core/src/adapt/claude-adapter.ts
import os from 'node:os';
import path from 'node:path';
import { copySkillDirectory, removeDirectory } from '../store/file-copy.js';
import type { ToolAdapter } from './tool-adapter.js';

export class ClaudeAdapter implements ToolAdapter {
  readonly name = 'claude';

  projectDir(root: string): string {
    return path.join(root, '.claude', 'skills');
  }

  globalDir(): string {
    return path.join(os.homedir(), '.claude', 'skills');
  }

  async adapt(skillSourceDir: string, skillName: string, targetBaseDir: string): Promise<void> {
    const targetDir = path.join(targetBaseDir, skillName);
    await copySkillDirectory(skillSourceDir, targetDir);
  }

  async clean(targetBaseDir: string): Promise<void> {
    await removeDirectory(targetBaseDir);
  }
}
```

- [ ] **Step 5: Implement Codex adapter**

```typescript
// packages/core/src/adapt/codex-adapter.ts
import os from 'node:os';
import path from 'node:path';
import { copySkillDirectory, removeDirectory } from '../store/file-copy.js';
import type { ToolAdapter } from './tool-adapter.js';

export class CodexAdapter implements ToolAdapter {
  readonly name = 'codex';

  projectDir(root: string): string {
    return path.join(root, '.agents', 'skills');
  }

  globalDir(): string {
    return path.join(os.homedir(), '.agents', 'skills');
  }

  async adapt(skillSourceDir: string, skillName: string, targetBaseDir: string): Promise<void> {
    const targetDir = path.join(targetBaseDir, skillName);
    await copySkillDirectory(skillSourceDir, targetDir);
  }

  async clean(targetBaseDir: string): Promise<void> {
    await removeDirectory(targetBaseDir);
  }
}
```

- [ ] **Step 6: Implement TRAE adapter**

```typescript
// packages/core/src/adapt/trae-adapter.ts
import os from 'node:os';
import path from 'node:path';
import { copySkillDirectory, removeDirectory } from '../store/file-copy.js';
import type { ToolAdapter } from './tool-adapter.js';

export class TraeAdapter implements ToolAdapter {
  readonly name = 'trae';

  projectDir(root: string): string {
    return path.join(root, '.trae', 'skills');
  }

  globalDir(): string {
    return path.join(os.homedir(), '.trae', 'skills');
  }

  async adapt(skillSourceDir: string, skillName: string, targetBaseDir: string): Promise<void> {
    const targetDir = path.join(targetBaseDir, skillName);
    await copySkillDirectory(skillSourceDir, targetDir);
  }

  async clean(targetBaseDir: string): Promise<void> {
    await removeDirectory(targetBaseDir);
  }
}
```

- [ ] **Step 7: Create adapt index with factory**

```typescript
// packages/core/src/adapt/index.ts
export type { ToolAdapter } from './tool-adapter.js';
export { ClaudeAdapter } from './claude-adapter.js';
export { CodexAdapter } from './codex-adapter.js';
export { TraeAdapter } from './trae-adapter.js';

import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { TraeAdapter } from './trae-adapter.js';
import type { ToolAdapter } from './tool-adapter.js';

export const SUPPORTED_TOOLS = ['claude', 'codex', 'trae'] as const;

const adapters: Record<string, () => ToolAdapter> = {
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
  trae: () => new TraeAdapter()
};

export function getAdapter(name: string): ToolAdapter {
  const factory = adapters[name];
  if (!factory) {
    throw new Error(`Unknown tool: ${name}. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`);
  }
  return factory();
}
```

- [ ] **Step 8: Export from core index**

Add to `packages/core/src/index.ts`:

```typescript
export * from './adapt/index.js';
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/tool-adapter.test.ts`
Expected: PASS

- [ ] **Step 10: Run full test suite and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/core/src/adapt/ packages/core/tests/tool-adapter.test.ts packages/core/src/index.ts
git commit -m "feat(core): add ToolAdapter interface with Claude, Codex, and TRAE implementations"
```

---

### Task 4: Adapt Engine

**Files:**
- Create: `packages/core/src/adapt/adapt-engine.ts`
- Modify: `packages/core/src/adapt/index.ts` — add export for `AdaptEngine`
- Create: `packages/core/tests/adapt-engine.test.ts`

**Interfaces:**
- Consumes:
  - `getAdapter(name)` from Task 3
  - `loadSkillsJson(projectRoot)` from Task 2
  - `loadConfig(options)` from existing `local-store.ts`
  - `parseSkillName(name)` from existing `schema/skill-json.ts`
- Produces:
  - `AdaptResult` type — `{ tool: string; skills: string[] }[]`
  - `adaptProject(projectRoot: string, options?: { homeDir?: string }): Promise<AdaptResult>` — adapt all project skills to configured tools
  - `adaptGlobal(options?: { homeDir?: string }): Promise<AdaptResult>` — adapt all global skills to configured tools

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/tests/adapt-engine.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adaptProject } from '../src/adapt/adapt-engine.js';
import { initializeLocalStore, saveConfig } from '../src/store/local-store.js';

describe('adaptProject', () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapt-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapt-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude', 'codex'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('copies skills from .skills/ to each tool directory', async () => {
    // Set up a skill in .skills/
    const skillDir = path.join(tmpDir, '.skills', '@scope', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill');
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({ name: '@scope/my-skill', version: '1.0.0', description: 'Test', author: 'test' })
    );

    const result = await adaptProject(tmpDir, { homeDir });

    // Check Claude
    expect(fs.readFileSync(path.join(tmpDir, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe('# My Skill');
    // Check Codex
    expect(fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe('# My Skill');
    // TRAE not in tools config, should not exist
    expect(fs.existsSync(path.join(tmpDir, '.trae', 'skills', 'my-skill'))).toBe(false);

    expect(result).toEqual([
      { tool: 'claude', skills: ['my-skill'] },
      { tool: 'codex', skills: ['my-skill'] }
    ]);
  });

  it('respects project-level tools override', async () => {
    const skillDir = path.join(tmpDir, '.skills', '@scope', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill');
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({ name: '@scope/my-skill', version: '1.0.0', description: 'Test', author: 'test' })
    );

    // Project-level override: only trae
    fs.writeFileSync(
      path.join(tmpDir, '.skills.json'),
      JSON.stringify({ skills: { '@scope/my-skill': '^1.0.0' }, tools: ['trae'] })
    );

    const result = await adaptProject(tmpDir, { homeDir });

    expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'my-skill'))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, '.trae', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe('# My Skill');
    expect(result).toEqual([{ tool: 'trae', skills: ['my-skill'] }]);
  });

  it('cleans tool directories before adapting', async () => {
    // Pre-existing stale skill
    const staleDir = path.join(tmpDir, '.claude', 'skills', 'old-skill');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'SKILL.md'), '# Old');

    // No skills installed
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });

    await adaptProject(tmpDir, { homeDir });

    expect(fs.existsSync(staleDir)).toBe(false);
  });

  it('throws when no tools are configured', async () => {
    await saveConfig({ tools: [] }, { homeDir });
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });

    await expect(adaptProject(tmpDir, { homeDir })).rejects.toThrow('No tools configured');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/adapt-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement adapt engine**

```typescript
// packages/core/src/adapt/adapt-engine.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, type LocalStoreOptions, resolveLocalStorePaths } from '../store/local-store.js';
import { loadSkillsJson } from '../store/skills-json.js';
import { parseSkillName } from '../schema/skill-json.js';
import { getAdapter } from './index.js';

export interface AdaptResult {
  tool: string;
  skills: string[];
}

interface AdaptOptions extends LocalStoreOptions {
  // Future extensibility
}

async function resolveToolList(projectRoot: string, options: AdaptOptions): Promise<string[]> {
  const projectSkillsJson = await loadSkillsJson(projectRoot);
  if (projectSkillsJson.tools && projectSkillsJson.tools.length > 0) {
    return projectSkillsJson.tools;
  }
  const config = await loadConfig(options);
  return config.tools;
}

async function scanSkillsDir(skillsDir: string): Promise<{ name: string; path: string }[]> {
  const skills: { name: string; path: string }[] = [];

  let scopes;
  try {
    scopes = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const scope of scopes) {
    if (!scope.isDirectory() || !scope.name.startsWith('@')) {
      continue;
    }
    const scopePath = path.join(skillsDir, scope.name);
    const entries = await fs.readdir(scopePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        skills.push({
          name: entry.name,
          path: path.join(scopePath, entry.name)
        });
      }
    }
  }

  return skills;
}

export async function adaptProject(
  projectRoot: string,
  options: AdaptOptions = {}
): Promise<AdaptResult[]> {
  const tools = await resolveToolList(projectRoot, options);
  if (tools.length === 0) {
    throw new Error('No tools configured. Run: esl config set tools claude,codex');
  }

  const skillsDir = path.join(projectRoot, '.skills');
  const skills = await scanSkillsDir(skillsDir);
  const results: AdaptResult[] = [];

  for (const toolName of tools) {
    const adapter = getAdapter(toolName);
    const targetBase = adapter.projectDir(projectRoot);
    await adapter.clean(targetBase);

    const adaptedSkills: string[] = [];
    for (const skill of skills) {
      await adapter.adapt(skill.path, skill.name, targetBase);
      adaptedSkills.push(skill.name);
    }
    results.push({ tool: toolName, skills: adaptedSkills });
  }

  return results;
}

export async function adaptGlobal(options: AdaptOptions = {}): Promise<AdaptResult[]> {
  const config = await loadConfig(options);
  if (config.tools.length === 0) {
    throw new Error('No tools configured. Run: esl config set tools claude,codex');
  }

  const paths = resolveLocalStorePaths(options);
  const skills = await scanSkillsDir(paths.skillsDir);
  const results: AdaptResult[] = [];

  for (const toolName of config.tools) {
    const adapter = getAdapter(toolName);
    const targetBase = adapter.globalDir();
    await adapter.clean(targetBase);

    const adaptedSkills: string[] = [];
    for (const skill of skills) {
      await adapter.adapt(skill.path, skill.name, targetBase);
      adaptedSkills.push(skill.name);
    }
    results.push({ tool: toolName, skills: adaptedSkills });
  }

  return results;
}
```

- [ ] **Step 4: Update adapt/index.ts to export engine**

Add to `packages/core/src/adapt/index.ts`:

```typescript
export { adaptProject, adaptGlobal, type AdaptResult } from './adapt-engine.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/adapt-engine.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/core/src/adapt/adapt-engine.ts packages/core/src/adapt/index.ts packages/core/tests/adapt-engine.test.ts
git commit -m "feat(core): add adapt engine for project and global skill synchronization"
```

---

### Task 5: `esl adapt` CLI Command

**Files:**
- Create: `packages/cli/src/commands/adapt.ts`
- Modify: `packages/cli/src/index.ts:1-11` — add adapt export
- Modify: `packages/cli/src/bin/esl.ts:1-131` — register adapt command

**Interfaces:**
- Consumes:
  - `adaptProject(projectRoot, options)` from Task 4
  - `adaptGlobal(options)` from Task 4
  - `AdaptResult` type from Task 4
- Produces:
  - `executeAdapt(options?: { global?: boolean; directory?: string }): Promise<AdaptResult[]>`

- [ ] **Step 1: Implement adapt command**

```typescript
// packages/cli/src/commands/adapt.ts
import { adaptProject, adaptGlobal, type AdaptResult } from '@esl/core';

export interface AdaptCommandOptions {
  global?: boolean;
  directory?: string;
}

export async function executeAdapt(options: AdaptCommandOptions = {}): Promise<AdaptResult[]> {
  if (options.global) {
    return adaptGlobal();
  }
  const projectRoot = options.directory ?? process.cwd();
  return adaptProject(projectRoot);
}
```

- [ ] **Step 2: Add export to CLI index**

Add to `packages/cli/src/index.ts`:

```typescript
export * from './commands/adapt.js';
```

- [ ] **Step 3: Register adapt command in esl.ts**

Add after the `install` command block (after line 81) in `packages/cli/src/bin/esl.ts`:

```typescript
  program
    .command('adapt')
    .description('Sync installed skills to AI tool directories')
    .option('--global', 'Adapt global skills instead of project skills')
    .option('--directory <path>', 'Project directory', process.cwd())
    .action(async (options: { global?: boolean; directory?: string }) => {
      const results = await executeAdapt(options);
      for (const result of results) {
        console.log(`${result.tool}: ${result.skills.length} skill(s) synced`);
      }
    });
```

Add the import at the top of `packages/cli/src/bin/esl.ts`:

```typescript
import { executeAdapt } from '../commands/adapt.js';
```

- [ ] **Step 4: Build and verify command registers**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Run full test suite and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/cli/src/commands/adapt.ts packages/cli/src/index.ts packages/cli/src/bin/esl.ts
git commit -m "feat(cli): add esl adapt command"
```

---

### Task 6: `esl install` Rework

**Files:**
- Modify: `packages/cli/src/commands/install.ts:1-37` — full rework
- Modify: `packages/cli/src/commands/network-options.ts:52-55` — add `projectSkillsDir`
- Modify: `packages/cli/src/bin/esl.ts` — update install command registration
- Modify: `packages/cli/tests/install.test.ts:1-37` — update tests
- Create: `packages/cli/tests/install-project.test.ts` — new project-level tests

**Interfaces:**
- Consumes:
  - `validateSkillDirectory(directory)` from existing core
  - `parseSkillName(name)` from existing core
  - `copySkillDirectory(source, target)` from Task 1
  - `removeDirectory(target)` from Task 1
  - `addSkillDependency(projectRoot, name, specifier)` from Task 2
  - `addLockEntry(projectRoot, name, entry)` from Task 2
  - `adaptProject(projectRoot, options)` from Task 4
  - `loadSkillsJson(projectRoot)` from Task 2
  - `loadSkillsLock(projectRoot)` from Task 2
  - `executeInfo(name, options)` from existing CLI
  - `resolveNetworkConfig(options)` from existing CLI
- Produces:
  - `executeInstall(nameOrPath: string, options?: InstallOptions): Promise<string>` — reworked to support project-level and local path

- [ ] **Step 1: Add projectSkillsDir to network-options.ts**

Add to `packages/cli/src/commands/network-options.ts` after line 55:

```typescript
export function projectSkillsDir(projectRoot: string, skillName: string): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(projectRoot, '.skills', `@${scope}`, shortName);
}
```

- [ ] **Step 2: Write new test for project-level install**

```typescript
// packages/cli/tests/install-project.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInstall } from '../src/commands/install.js';
import { loadSkillsJson, loadSkillsLock, initializeLocalStore, saveConfig } from '@esl/core';

describe('esl install (project-level)', () => {
  let projectDir: string;
  let homeDir: string;
  let localSkillDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-install-proj-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-install-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });

    // Create a local skill to install from path
    localSkillDir = path.join(projectDir, 'my-local-skill');
    const skillSubDir = path.join(localSkillDir, 'my-skill');
    // Actually, esl install ../path expects the path to be a valid skill directory
    // The directory name must match SKILL.md name
    fs.mkdirSync(localSkillDir);
    fs.writeFileSync(
      path.join(localSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/my-local-skill',
        version: '0.2.0',
        description: 'A local test skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: my-local-skill\ndescription: Local test skill.\n---\n\n# My Local Skill\n'
    );
    fs.mkdirSync(path.join(localSkillDir, 'scripts'));
    fs.mkdirSync(path.join(localSkillDir, 'references'));
    fs.mkdirSync(path.join(localSkillDir, 'assets'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('installs a skill from a local path to project .skills/', async () => {
    const targetDir = await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    const expectedDir = path.join(projectDir, '.skills', '@myorg', 'my-local-skill');
    expect(targetDir).toBe(expectedDir);
    expect(fs.existsSync(path.join(expectedDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(expectedDir, '.git'))).toBe(false);

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@myorg/my-local-skill']).toBe(`file:${localSkillDir}`);
  });

  it('installs from server to project .skills/', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const targetDir = await executeInstall('@alice/code-review', {
      projectRoot: projectDir,
      homeDir,
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      noAdapt: true
    });

    const expectedDir = path.join(projectDir, '.skills', '@alice', 'code-review');
    expect(targetDir).toBe(expectedDir);
  });

  it('installs from server to global with --global', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const targetDir = await executeInstall('@alice/code-review', {
      homeDir,
      global: true,
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      noAdapt: true
    });

    expect(targetDir).toBe(
      path.normalize(path.join(homeDir, '.skill-library', 'skills', '@alice', 'code-review'))
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/cli/tests/install-project.test.ts`
Expected: FAIL — missing options/behavior

- [ ] **Step 4: Rework install.ts**

Replace the entire contents of `packages/cli/src/commands/install.ts`:

```typescript
// packages/cli/src/commands/install.ts
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  validateSkillDirectory,
  parseSkillName,
  copySkillDirectory,
  removeDirectory,
  addSkillDependency,
  addLockEntry,
  loadSkillsJson,
  loadSkillsLock,
  adaptProject
} from '@esl/core';
import {
  authenticatedGitUrl,
  installTargetDir,
  projectSkillsDir,
  requireConfigured,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';

const defaultExecFileAsync = promisify(execFile);

export interface InstallOptions extends NetworkCommandOptions {
  version?: string;
  global?: boolean;
  noAdapt?: boolean;
  projectRoot?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

function isLocalPath(nameOrPath: string): boolean {
  return nameOrPath.startsWith('.') || nameOrPath.startsWith('/') || nameOrPath.startsWith('\\') || path.isAbsolute(nameOrPath);
}

async function installFromLocalPath(
  sourcePath: string,
  projectRoot: string,
  options: InstallOptions
): Promise<string> {
  const resolved = path.resolve(sourcePath);
  const validation = await validateSkillDirectory(resolved);
  if (!validation.success) {
    throw new Error(`Invalid skill package at ${resolved}: ${validation.errors.join(', ')}`);
  }

  const { skillJson } = validation.data;
  const targetDir = projectSkillsDir(projectRoot, skillJson.name);
  await copySkillDirectory(resolved, targetDir);
  await addSkillDependency(projectRoot, skillJson.name, `file:${resolved}`);

  return targetDir;
}

async function installFromServer(
  name: string,
  projectRoot: string | null,
  options: InstallOptions
): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
  const info = await executeInfo(name, options);
  const repoPath = requireConfigured(info.gitRepoPath, 'gitRepoPath');
  const remoteUrl = authenticatedGitUrl(gitHttpBase, authToken, repoPath);

  const version = options.version ?? info.versions?.[0];
  let targetDir: string;

  if (options.global || !projectRoot) {
    // Global install: clone directly to global skills dir (legacy behavior)
    targetDir = path.normalize(installTargetDir(name, options));
    await removeDirectory(targetDir);
    await execFileAsync('git', ['clone', remoteUrl, targetDir]);
    if (version) {
      await execFileAsync('git', ['checkout', version], { cwd: targetDir });
    }
  } else {
    // Project install: clone to temp, copy to .skills/ (no .git/)
    const os = await import('node:os');
    const tmpDir = await fs.mkdtemp(path.join(os.default.tmpdir(), 'esl-install-'));
    try {
      const cloneDir = path.join(tmpDir, 'repo');
      await execFileAsync('git', ['clone', remoteUrl, cloneDir]);
      if (version) {
        await execFileAsync('git', ['checkout', version], { cwd: cloneDir });
      }

      targetDir = projectSkillsDir(projectRoot, name);
      await copySkillDirectory(cloneDir, targetDir);

      const versionSpec = version ? `^${version}` : '^0.0.0';
      await addSkillDependency(projectRoot, name, versionSpec);

      if (version) {
        await addLockEntry(projectRoot, name, {
          version,
          resolved: repoPath,
          integrity: ''
        });
      }
    } finally {
      await removeDirectory(tmpDir);
    }
  }

  return targetDir;
}

export async function executeInstall(nameOrPath: string, options: InstallOptions = {}): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();

  let targetDir: string;
  if (isLocalPath(nameOrPath)) {
    targetDir = await installFromLocalPath(nameOrPath, projectRoot, options);
  } else {
    targetDir = await installFromServer(nameOrPath, options.global ? null : projectRoot, options);
  }

  if (!options.noAdapt && !options.global) {
    await adaptProject(projectRoot, { homeDir: options.homeDir });
  }

  return targetDir;
}
```

- [ ] **Step 5: Update esl.ts install command registration**

Replace the install command block in `packages/cli/src/bin/esl.ts` (lines 71-81):

```typescript
  program
    .command('install')
    .argument('[name-or-path]', 'skill name (@scope/skill) or local path')
    .option('--version <version>', 'version to install')
    .option('--global', 'Install to global skills directory')
    .option('--no-adapt', 'Skip automatic adapt after install')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .option('--token <token>', 'Gitea personal access token')
    .action(async (nameOrPath: string | undefined, options: { version?: string; global?: boolean; adapt?: boolean; registry?: string; gitBase?: string; token?: string }) => {
      if (!nameOrPath) {
        // bare `esl install` — restore all deps from .skills.json
        console.log('Restoring skills from .skills.json...');
        // TODO: implement bare install in a future task
        return;
      }
      const targetDir = await executeInstall(nameOrPath, { ...options, noAdapt: options.adapt === false });
      console.log(`Skill installed at ${targetDir}`);
    });
```

- [ ] **Step 6: Update the existing install test**

Replace `packages/cli/tests/install.test.ts` to match new behavior:

```typescript
// packages/cli/tests/install.test.ts
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { executeInstall } from '../src/commands/install.js';

describe('esl install (global mode)', () => {
  it('clones a scoped skill into the global path with --global', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const homeDir = 'C:\\temp\\esl-install-home';

    await executeInstall('@alice/code-review', {
      homeDir,
      global: true,
      noAdapt: true,
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'clone',
        expect.stringContaining('/esl-skills/alice_code-review.git'),
        path.join(homeDir, '.skill-library', 'skills', '@alice', 'code-review')
      ]
    );
  });
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run packages/cli/tests/install.test.ts packages/cli/tests/install-project.test.ts`
Expected: PASS

- [ ] **Step 8: Run full test suite and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/cli/src/commands/install.ts packages/cli/src/commands/network-options.ts packages/cli/src/bin/esl.ts packages/cli/tests/install.test.ts packages/cli/tests/install-project.test.ts
git commit -m "feat(cli): rework esl install for project-level default with local path support"
```

---

### Task 7: `esl clone` Command

**Files:**
- Create: `packages/cli/src/commands/clone.ts`
- Create: `packages/cli/tests/clone.test.ts`
- Modify: `packages/cli/src/index.ts` — add export
- Modify: `packages/cli/src/bin/esl.ts` — register command

**Interfaces:**
- Consumes:
  - `executeInfo(name, options)` from existing CLI
  - `resolveNetworkConfig(options)` from existing CLI
  - `authenticatedGitUrl(gitBase, token, repoPath)` from existing CLI
  - `parseSkillName(name)` from existing core
- Produces:
  - `executeClone(name: string, options?: CloneOptions): Promise<string>` — returns clone target directory

- [ ] **Step 1: Write failing test**

```typescript
// packages/cli/tests/clone.test.ts
import { describe, expect, it, vi } from 'vitest';
import { executeClone } from '../src/commands/clone.js';

describe('esl clone', () => {
  it('clones the full git repository to the target directory', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const targetDir = await executeClone('@alice/code-review', {
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      cwd: '/tmp/test-dir'
    });

    expect(targetDir).toContain('code-review');
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['clone', expect.stringContaining('/esl-skills/alice_code-review.git'), expect.stringContaining('code-review')]
    );
  });

  it('clones to a custom target directory', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const targetDir = await executeClone('@alice/code-review', {
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      target: '/tmp/my-clone-dir'
    });

    expect(targetDir).toBe('/tmp/my-clone-dir');
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['clone', expect.stringContaining('/esl-skills/alice_code-review.git'), '/tmp/my-clone-dir']
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/cli/tests/clone.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement clone command**

```typescript
// packages/cli/src/commands/clone.ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSkillName } from '@esl/core';
import {
  authenticatedGitUrl,
  requireConfigured,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';

const defaultExecFileAsync = promisify(execFile);

export interface CloneOptions extends NetworkCommandOptions {
  target?: string;
  cwd?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

export async function executeClone(name: string, options: CloneOptions = {}): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
  const info = await executeInfo(name, options);
  const repoPath = requireConfigured(info.gitRepoPath, 'gitRepoPath');
  const remoteUrl = authenticatedGitUrl(gitHttpBase, authToken, repoPath);

  const { skillName } = parseSkillName(name);
  const cwd = options.cwd ?? process.cwd();
  const targetDir = options.target ?? path.join(cwd, skillName);

  await execFileAsync('git', ['clone', remoteUrl, targetDir]);

  return targetDir;
}
```

- [ ] **Step 4: Add export and register command**

Add to `packages/cli/src/index.ts`:

```typescript
export * from './commands/clone.js';
```

Add to `packages/cli/src/bin/esl.ts` after the adapt command block:

```typescript
  program
    .command('clone')
    .description('Clone skill source for development')
    .argument('<skill-name>')
    .argument('[target]', 'target directory')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .option('--token <token>', 'Gitea personal access token')
    .action(async (skillName: string, target: string | undefined, options: { registry?: string; gitBase?: string; token?: string }) => {
      const targetDir = await executeClone(skillName, { ...options, target });
      console.log(`Skill cloned to ${targetDir}`);
    });
```

Add the import:

```typescript
import { executeClone } from '../commands/clone.js';
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/cli/src/commands/clone.ts packages/cli/tests/clone.test.ts packages/cli/src/index.ts packages/cli/src/bin/esl.ts
git commit -m "feat(cli): add esl clone command for collaborative skill development"
```

---

### Task 8: `esl update` Command

**Files:**
- Create: `packages/cli/src/commands/update.ts`
- Create: `packages/cli/tests/update.test.ts`
- Modify: `packages/cli/src/index.ts` — add export
- Modify: `packages/cli/src/bin/esl.ts` — register command

**Interfaces:**
- Consumes:
  - `loadSkillsJson(projectRoot)` from Task 2
  - `loadSkillsLock(projectRoot)` from Task 2
  - `executeInstall(name, options)` from Task 6
  - `executeInfo(name, options)` from existing CLI
- Produces:
  - `UpdateResult` type — `{ name: string; from: string; to: string }[]`
  - `executeUpdate(options?: UpdateOptions): Promise<UpdateResult>`

- [ ] **Step 1: Write failing test**

```typescript
// packages/cli/tests/update.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeUpdate } from '../src/commands/update.js';
import { initializeLocalStore, saveConfig, saveSkillsJson, saveSkillsLock } from '@esl/core';

describe('esl update', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-update-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-update-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('skips file: dependencies', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@myorg/local-skill': 'file:../local-skill' }
    });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    expect(result).toEqual([]);
  });

  it('reports already up-to-date skills', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@myorg/my-skill': '^1.0.0' }
    });
    await saveSkillsLock(projectDir, {
      lockfileVersion: 1,
      skills: {
        '@myorg/my-skill': { version: '1.2.0', resolved: 'esl-skills/myorg_my-skill', integrity: '' }
      }
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@myorg/my-skill',
        gitRepoPath: 'esl-skills/myorg_my-skill',
        versions: ['1.2.0', '1.0.0']
      })
    });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      noAdapt: true,
      customFetch: fetchImpl as any
    });

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/cli/tests/update.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement update command**

```typescript
// packages/cli/src/commands/update.ts
import { loadSkillsJson, loadSkillsLock, adaptProject } from '@esl/core';
import { executeInfo } from './info.js';
import { executeInstall, type InstallOptions } from './install.js';
import type { NetworkCommandOptions } from './network-options.js';

export interface UpdateOptions extends NetworkCommandOptions {
  projectRoot?: string;
  skillName?: string;
  global?: boolean;
  noAdapt?: boolean;
}

export interface UpdateResultEntry {
  name: string;
  from: string;
  to: string;
}

export async function executeUpdate(options: UpdateOptions = {}): Promise<UpdateResultEntry[]> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const skillsJson = await loadSkillsJson(projectRoot);
  const lockJson = await loadSkillsLock(projectRoot);
  const results: UpdateResultEntry[] = [];

  const skillEntries = Object.entries(skillsJson.skills);

  for (const [name, specifier] of skillEntries) {
    // Skip local path dependencies
    if (specifier.startsWith('file:')) {
      continue;
    }

    // If filtering by name, skip non-matching
    if (options.skillName && options.skillName !== name) {
      continue;
    }

    try {
      const info = await executeInfo(name, options);
      const latestVersion = info.versions?.[0];
      if (!latestVersion) {
        continue;
      }

      const currentVersion = lockJson.skills[name]?.version;
      if (currentVersion === latestVersion) {
        continue;
      }

      await executeInstall(name, {
        ...options,
        projectRoot,
        version: latestVersion,
        noAdapt: true
      });

      results.push({
        name,
        from: currentVersion ?? 'unknown',
        to: latestVersion
      });
    } catch (error) {
      console.error(`Failed to update ${name}: ${(error as Error).message}`);
    }
  }

  if (!options.noAdapt && results.length > 0) {
    await adaptProject(projectRoot, { homeDir: options.homeDir });
  }

  return results;
}
```

- [ ] **Step 4: Add export and register command**

Add to `packages/cli/src/index.ts`:

```typescript
export * from './commands/update.js';
```

Add to `packages/cli/src/bin/esl.ts`:

```typescript
  program
    .command('update')
    .description('Update installed skills to latest versions')
    .argument('[skill-name]', 'specific skill to update')
    .option('--global', 'Update global skills')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .option('--token <token>', 'Gitea personal access token')
    .action(async (skillName: string | undefined, options: { global?: boolean; registry?: string; gitBase?: string; token?: string }) => {
      const results = await executeUpdate({ ...options, skillName });
      if (results.length === 0) {
        console.log('All skills are up to date');
        return;
      }
      for (const r of results) {
        console.log(`${r.name}: ${r.from} → ${r.to}`);
      }
    });
```

Add the import:

```typescript
import { executeUpdate } from '../commands/update.js';
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/cli/src/commands/update.ts packages/cli/tests/update.test.ts packages/cli/src/index.ts packages/cli/src/bin/esl.ts
git commit -m "feat(cli): add esl update command for skill version updates"
```

---

### Task 9: `esl uninstall` Command + `.gitignore` Management

**Files:**
- Create: `packages/cli/src/commands/uninstall.ts`
- Create: `packages/cli/tests/uninstall.test.ts`
- Modify: `packages/cli/src/index.ts` — add export
- Modify: `packages/cli/src/bin/esl.ts` — register command

**Interfaces:**
- Consumes:
  - `removeSkillDependency(projectRoot, name)` from Task 2
  - `removeDirectory(target)` from Task 1
  - `adaptProject(projectRoot, options)` from Task 4
  - `projectSkillsDir(projectRoot, name)` from Task 6
- Produces:
  - `executeUninstall(name: string, options?: UninstallOptions): Promise<void>`
  - `ensureGitignore(projectRoot: string): Promise<void>` — appends ESL entries to `.gitignore` if missing

- [ ] **Step 1: Write failing tests**

```typescript
// packages/cli/tests/uninstall.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeUninstall } from '../src/commands/uninstall.js';
import { ensureGitignore } from '../src/commands/uninstall.js';
import { addSkillDependency, addLockEntry, loadSkillsJson, loadSkillsLock, initializeLocalStore, saveConfig } from '@esl/core';

describe('esl uninstall', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-uninstall-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-uninstall-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('removes skill directory and dependency entries', async () => {
    // Set up installed skill
    const skillDir = path.join(projectDir, '.skills', '@myorg', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test');
    await addSkillDependency(projectDir, '@myorg/my-skill', '^1.0.0');
    await addLockEntry(projectDir, '@myorg/my-skill', {
      version: '1.0.0',
      resolved: 'esl-skills/myorg_my-skill',
      integrity: ''
    });

    await executeUninstall('@myorg/my-skill', {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    expect(fs.existsSync(skillDir)).toBe(false);
    const skills = await loadSkillsJson(projectDir);
    expect(skills.skills['@myorg/my-skill']).toBeUndefined();
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@myorg/my-skill']).toBeUndefined();
  });
});

describe('ensureGitignore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-gitignore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with ESL entries if missing', async () => {
    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('.skills/');
    expect(content).toContain('.claude/skills/');
    expect(content).toContain('.agents/skills/');
    expect(content).toContain('.trae/skills/');
  });

  it('appends ESL entries if .gitignore exists without them', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');

    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.skills/');
  });

  it('does not duplicate entries if already present', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.skills/\n');

    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    const matches = content.match(/\.skills\//g);
    expect(matches).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/cli/tests/uninstall.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement uninstall command with gitignore management**

```typescript
// packages/cli/src/commands/uninstall.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName, removeSkillDependency, removeDirectory, adaptProject } from '@esl/core';
import { projectSkillsDir } from './network-options.js';
import type { LocalStoreOptions } from '@esl/core';

export interface UninstallOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  noAdapt?: boolean;
}

export async function executeUninstall(name: string, options: UninstallOptions = {}): Promise<void> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const targetDir = projectSkillsDir(projectRoot, name);

  await removeDirectory(targetDir);
  await removeSkillDependency(projectRoot, name);

  if (!options.noAdapt) {
    await adaptProject(projectRoot, { homeDir: options.homeDir });
  }
}

const ESL_GITIGNORE_MARKER = '# ESL managed (do not edit)';
const ESL_GITIGNORE_ENTRIES = ['.skills/', '.claude/skills/', '.agents/skills/', '.trae/skills/'];

export async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let content = '';

  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // File doesn't exist
  }

  if (content.includes(ESL_GITIGNORE_MARKER)) {
    return; // Already has ESL entries
  }

  // Check if individual entries already exist
  const missingEntries = ESL_GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));
  if (missingEntries.length === 0) {
    return;
  }

  const newBlock = `\n${ESL_GITIGNORE_MARKER}\n${missingEntries.join('\n')}\n`;
  content = content.trimEnd() + newBlock;

  await fs.writeFile(gitignorePath, content, 'utf8');
}
```

- [ ] **Step 4: Add export and register command**

Add to `packages/cli/src/index.ts`:

```typescript
export * from './commands/uninstall.js';
```

Add to `packages/cli/src/bin/esl.ts`:

```typescript
  program
    .command('uninstall')
    .description('Remove an installed skill')
    .argument('<skill-name>')
    .option('--global', 'Uninstall from global skills directory')
    .action(async (skillName: string, options: { global?: boolean }) => {
      await executeUninstall(skillName, options);
      console.log(`Skill ${skillName} uninstalled`);
    });
```

Add the import:

```typescript
import { executeUninstall } from '../commands/uninstall.js';
```

- [ ] **Step 5: Integrate ensureGitignore into install flow**

Add to `packages/cli/src/commands/install.ts`, at the end of the `executeInstall` function, before the return statement:

```typescript
  // Ensure .gitignore has ESL entries
  if (!options.global) {
    const { ensureGitignore } = await import('./uninstall.js');
    await ensureGitignore(projectRoot);
  }
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test`
Expected: All tests pass

```bash
git add packages/cli/src/commands/uninstall.ts packages/cli/tests/uninstall.test.ts packages/cli/src/index.ts packages/cli/src/bin/esl.ts packages/cli/src/commands/install.ts
git commit -m "feat(cli): add esl uninstall command and .gitignore management"
```

---

### Task 10: Integration Verification

**Files:**
- Modify: `packages/cli/tests/bin.test.ts:9-14` — update expected command list

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified build and complete test coverage

- [ ] **Step 1: Update bin test to include new commands**

In `packages/cli/tests/bin.test.ts`, update the command names assertion (line 13):

```typescript
    expect(commandNames).toEqual(
      expect.arrayContaining(['init', 'validate', 'version', 'install', 'adapt', 'clone', 'update', 'uninstall'])
    );
```

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Final commit**

```bash
git add packages/cli/tests/bin.test.ts
git commit -m "test: verify all new commands are registered in CLI"
```
