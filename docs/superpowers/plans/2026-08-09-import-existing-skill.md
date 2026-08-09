# Import Existing Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `esl import <path> [--namespace <namespace>]` to turn an existing `SKILL.md` directory into a minimal ESL package and install it into the current project.

**Architecture:** Core owns reusable import preparation: read `SKILL.md`, derive `@namespace/skill-name`, write missing `skill.json`, then validate. CLI owns argument parsing, output, and reusing `executeInstall` so copy, dependency registration, `.gitignore`, and adapt behavior stay in one place. `init` is simplified to generate only `skill.json` and `SKILL.md`.

**Tech Stack:** TypeScript ESM, Node.js `fs/promises`, Vitest, Commander, existing `@esl/core` validation and `@esl/cli` install command.

## Global Constraints

- Project conventions live in `docs/agent-coding-principles.md`.
- Reusable logic belongs in `packages/core`.
- CLI parsing, output, and exit behavior belong in `packages/cli`.
- Verify final changes with `npm test` and `npm run build`.
- Minimal skill package requires only `SKILL.md` and `skill.json`.
- `validate` remains read-only.
- `import` does not rename `SKILL.md.name`, does not rename directories, and does not overwrite existing `skill.json`.
- Default import namespace is `local`.
- `--namespace` selects only the namespace; skill-name always comes from `SKILL.md` frontmatter.

---

## File Structure

- Create `packages/core/src/skill/import-skill.ts`: reusable import preparation API.
- Modify `packages/core/src/index.ts`: export import preparation API.
- Create `packages/core/tests/import-skill.test.ts`: unit tests for generated `skill.json`, namespace validation, existing `skill.json` mismatch, and invalid `SKILL.md`.
- Create `packages/cli/src/commands/import.ts`: CLI-level function that calls core preparation and existing `executeInstall`.
- Modify `packages/cli/src/index.ts`: export `executeImport`.
- Modify `packages/cli/src/bin/esl.ts`: register `import` command with `--namespace` and `--no-adapt`.
- Create `packages/cli/tests/import.test.ts`: integration-ish CLI command tests using temp directories.
- Modify `packages/cli/tests/bin.test.ts`: assert command registration includes `import`.
- Modify `packages/cli/src/commands/init.ts`: stop creating `scripts/`, `references/`, and `assets`.
- Modify `packages/cli/tests/init.test.ts`: assert those optional directories are not created.

---

### Task 1: Core Import Preparation

**Files:**
- Create: `packages/core/src/skill/import-skill.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/import-skill.test.ts`

**Interfaces:**
- Consumes: `validateSkillMd(content: string)`, `validateSkillDirectory(directory: string)`, `parseSkillName(name: string)`, `validateSkillJson(data: unknown)`.
- Produces:
  - `export interface PrepareSkillImportOptions { namespace?: string; author?: string }`
  - `export interface PrepareSkillImportResult { directory: string; skillName: string; createdSkillJson: boolean }`
  - `export async function prepareSkillImport(directory: string, options?: PrepareSkillImportOptions): Promise<PrepareSkillImportResult>`

- [ ] **Step 1: Write failing core tests**

Create `packages/core/tests/import-skill.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareSkillImport } from '../src/index.js';

describe('prepareSkillImport', () => {
  let tmpRoot: string;
  let skillDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-import-core-'));
    skillDir = path.join(tmpRoot, 'brainstorming');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Explore ideas before implementation.\n---\n\n# Brainstorming\n'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates minimal skill.json with the local namespace by default', async () => {
    const result = await prepareSkillImport(skillDir, { author: 'tester' });

    expect(result).toEqual({
      directory: skillDir,
      skillName: '@local/brainstorming',
      createdSkillJson: true
    });
    expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8'))).toEqual({
      name: '@local/brainstorming',
      version: '0.1.0',
      description: 'Explore ideas before implementation.',
      author: 'tester',
      keywords: []
    });
  });

  it('uses an explicit namespace without changing the skill short name', async () => {
    await prepareSkillImport(skillDir, { namespace: 'cnfox', author: 'tester' });

    const skillJson = JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8'));
    expect(skillJson.name).toBe('@cnfox/brainstorming');
  });

  it('does not overwrite an existing matching skill.json', async () => {
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@local/brainstorming',
        version: '2.0.0',
        description: 'Existing description',
        author: 'existing',
        keywords: ['kept']
      })
    );

    const result = await prepareSkillImport(skillDir, { author: 'tester' });

    expect(result.createdSkillJson).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8')).version).toBe('2.0.0');
  });

  it('rejects an existing skill.json with a mismatched namespace', async () => {
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@other/brainstorming',
        version: '0.1.0',
        description: 'Existing description',
        author: 'existing'
      })
    );

    await expect(prepareSkillImport(skillDir, { namespace: 'cnfox' })).rejects.toThrow(
      'skill.json name "@other/brainstorming" must match import name "@cnfox/brainstorming"'
    );
  });

  it('rejects an invalid namespace', async () => {
    await expect(prepareSkillImport(skillDir, { namespace: 'Bad_Name' })).rejects.toThrow(
      'Namespace must use lowercase letters, digits, and hyphens'
    );
  });

  it('rejects invalid SKILL.md frontmatter', async () => {
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Missing frontmatter\n');

    await expect(prepareSkillImport(skillDir)).rejects.toThrow('SKILL.md: missing YAML frontmatter');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- --run packages/core/tests/import-skill.test.ts
```

Expected: FAIL because `prepareSkillImport` is not exported.

- [ ] **Step 3: Implement core import preparation**

Create `packages/core/src/skill/import-skill.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName, validateSkillJson, type SkillJson } from '../schema/skill-json.js';
import { validateSkillDirectory } from './directory-validator.js';
import { validateSkillMd } from './skill-md.js';

export interface PrepareSkillImportOptions {
  namespace?: string;
  author?: string;
}

export interface PrepareSkillImportResult {
  directory: string;
  skillName: string;
  createdSkillJson: boolean;
}

const NamespacePattern = /^[a-z0-9-]+$/;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readExistingSkillJson(skillJsonPath: string): Promise<SkillJson> {
  const raw = await fs.readFile(skillJsonPath, 'utf8');
  const validation = validateSkillJson(JSON.parse(raw));
  if (!validation.success) {
    throw new Error(validation.errors.join(', '));
  }
  return validation.data;
}

export async function prepareSkillImport(
  directory: string,
  options: PrepareSkillImportOptions = {}
): Promise<PrepareSkillImportResult> {
  const resolved = path.resolve(directory);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`${resolved} is not a directory`);
  }

  const skillMdPath = path.join(resolved, 'SKILL.md');
  const skillMdValidation = validateSkillMd(await fs.readFile(skillMdPath, 'utf8'));
  if (!skillMdValidation.success) {
    throw new Error(skillMdValidation.errors.join(', '));
  }

  const namespace = options.namespace ?? 'local';
  if (!NamespacePattern.test(namespace)) {
    throw new Error('Namespace must use lowercase letters, digits, and hyphens');
  }

  const skillName = `@${namespace}/${skillMdValidation.data.name}`;
  parseSkillName(skillName);

  const skillJsonPath = path.join(resolved, 'skill.json');
  const createdSkillJson = !(await fileExists(skillJsonPath));

  if (createdSkillJson) {
    const skillJson: SkillJson = {
      name: skillName,
      version: '0.1.0',
      description: skillMdValidation.data.description,
      author: options.author ?? process.env.USER ?? process.env.USERNAME ?? 'anonymous',
      keywords: []
    };
    await fs.writeFile(skillJsonPath, `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');
  } else {
    const existing = await readExistingSkillJson(skillJsonPath);
    if (existing.name !== skillName) {
      throw new Error(`skill.json name "${existing.name}" must match import name "${skillName}"`);
    }
  }

  const validation = await validateSkillDirectory(resolved);
  if (!validation.success) {
    throw new Error(`Invalid skill package at ${resolved}: ${validation.errors.join(', ')}`);
  }

  return {
    directory: resolved,
    skillName,
    createdSkillJson
  };
}
```

Modify `packages/core/src/index.ts`:

```ts
export const VERSION = '0.1.0';

export * from './adapt/index.js';
export * from './schema/skill-json.js';
export * from './schema/validation-result.js';
export * from './skill/directory-validator.js';
export * from './skill/import-skill.js';
export * from './skill/skill-md.js';
export * from './store/file-copy.js';
export * from './store/local-store.js';
export * from './store/skills-json.js';
export * from './version/version.js';
```

- [ ] **Step 4: Run core tests**

Run:

```powershell
npm test -- --run packages/core/tests/import-skill.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add packages/core/src/skill/import-skill.ts packages/core/src/index.ts packages/core/tests/import-skill.test.ts
git commit -m "feat(core): prepare existing skill imports"
```

---

### Task 2: CLI Import Command

**Files:**
- Create: `packages/cli/src/commands/import.ts`
- Create: `packages/cli/tests/import.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/bin/esl.ts`
- Modify: `packages/cli/tests/bin.test.ts`

**Interfaces:**
- Consumes: `prepareSkillImport(directory, { namespace, author })` from `@esl/core`.
- Consumes: `executeInstall(nameOrPath, { projectRoot, homeDir, noAdapt })` from `packages/cli/src/commands/install.ts`.
- Produces:
  - `export interface ImportOptions { namespace?: string; noAdapt?: boolean; projectRoot?: string; homeDir?: string; author?: string }`
  - `export interface ImportResult { skillName: string; sourceDir: string; targetDir: string; createdSkillJson: boolean }`
  - `export async function executeImport(sourcePath: string, options?: ImportOptions): Promise<ImportResult>`

- [ ] **Step 1: Write failing CLI import tests**

Create `packages/cli/tests/import.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSkillsJson } from '@esl/core';
import { executeImport } from '../src/index.js';

describe('esl import', () => {
  let projectDir: string;
  let homeDir: string;
  let sourceDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-import-project-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-import-home-'));
    sourceDir = path.join(projectDir, 'brainstorming');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Explore ideas before implementation.\n---\n\n# Brainstorming\n'
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('creates skill.json and installs the skill into project .skills with the local namespace', async () => {
    const result = await executeImport(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      author: 'tester',
      noAdapt: true
    });

    const expectedTarget = path.join(projectDir, '.skills', '@local', 'brainstorming');
    expect(result).toEqual({
      skillName: '@local/brainstorming',
      sourceDir: path.resolve(sourceDir),
      targetDir: expectedTarget,
      createdSkillJson: true
    });
    expect(JSON.parse(fs.readFileSync(path.join(sourceDir, 'skill.json'), 'utf8')).name).toBe(
      '@local/brainstorming'
    );
    expect(fs.existsSync(path.join(expectedTarget, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(expectedTarget, 'skill.json'))).toBe(true);

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@local/brainstorming']).toBe(`file:${path.resolve(sourceDir)}`);
  });

  it('uses an explicit namespace for the installed project path', async () => {
    const result = await executeImport(sourceDir, {
      namespace: 'cnfox',
      projectRoot: projectDir,
      homeDir,
      author: 'tester',
      noAdapt: true
    });

    expect(result.skillName).toBe('@cnfox/brainstorming');
    expect(result.targetDir).toBe(path.join(projectDir, '.skills', '@cnfox', 'brainstorming'));
  });

  it('runs adapt by default', async () => {
    await executeImport(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      author: 'tester'
    });

    expect(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'brainstorming', 'SKILL.md'))).toBe(true);
  });

  it('does not adapt when noAdapt is true', async () => {
    await executeImport(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      author: 'tester',
      noAdapt: true
    });

    expect(fs.existsSync(path.join(projectDir, '.agents'))).toBe(false);
  });
});
```

- [ ] **Step 2: Update failing command registration test**

Modify the command assertion in `packages/cli/tests/bin.test.ts`:

```ts
expect(commandNames).toEqual(
  expect.arrayContaining(['init', 'validate', 'version', 'install', 'import', 'adapt', 'clone', 'update', 'uninstall'])
);
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
npm test -- --run packages/cli/tests/import.test.ts packages/cli/tests/bin.test.ts
```

Expected: FAIL because `executeImport` and the `import` command do not exist.

- [ ] **Step 4: Implement CLI import command**

Create `packages/cli/src/commands/import.ts`:

```ts
import path from 'node:path';
import { prepareSkillImport } from '@esl/core';
import { executeInstall } from './install.js';

export interface ImportOptions {
  namespace?: string;
  noAdapt?: boolean;
  projectRoot?: string;
  homeDir?: string;
  author?: string;
}

export interface ImportResult {
  skillName: string;
  sourceDir: string;
  targetDir: string;
  createdSkillJson: boolean;
}

export async function executeImport(sourcePath: string, options: ImportOptions = {}): Promise<ImportResult> {
  const sourceDir = path.resolve(sourcePath);
  const prepared = await prepareSkillImport(sourceDir, {
    namespace: options.namespace,
    author: options.author
  });
  const targetDir = await executeInstall(prepared.directory, {
    projectRoot: options.projectRoot,
    homeDir: options.homeDir,
    noAdapt: options.noAdapt
  });

  return {
    skillName: prepared.skillName,
    sourceDir: prepared.directory,
    targetDir,
    createdSkillJson: prepared.createdSkillJson
  };
}
```

Modify `packages/cli/src/index.ts`:

```ts
export const CLI_NAME = 'esl';

export * from './commands/init.js';
export * from './commands/adapt.js';
export * from './commands/clone.js';
export * from './commands/import.js';
export * from './commands/info.js';
export * from './commands/install.js';
export * from './commands/login.js';
export * from './commands/publish.js';
export * from './commands/search.js';
export * from './commands/update.js';
export * from './commands/uninstall.js';
export * from './commands/validate.js';
export * from './commands/version.js';
```

Modify `packages/cli/src/bin/esl.ts` imports:

```ts
import { executeImport } from '../commands/import.js';
```

Add the command before `install` or immediately after it:

```ts
program
  .command('import')
  .description('Import an existing local skill directory into the current project')
  .argument('<path>', 'existing skill directory')
  .option('--namespace <namespace>', 'skill namespace', 'local')
  .option('--no-adapt', 'Skip automatic adapt after install')
  .action(async (sourcePath: string, options: { namespace?: string; adapt?: boolean }) => {
    const result = await executeImport(sourcePath, {
      namespace: options.namespace,
      noAdapt: options.adapt === false
    });
    console.log(`Skill ${result.skillName} imported at ${result.targetDir}`);
  });
```

- [ ] **Step 5: Run CLI tests**

Run:

```powershell
npm test -- --run packages/cli/tests/import.test.ts packages/cli/tests/bin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add packages/cli/src/commands/import.ts packages/cli/src/index.ts packages/cli/src/bin/esl.ts packages/cli/tests/import.test.ts packages/cli/tests/bin.test.ts
git commit -m "feat(cli): import existing local skills"
```

---

### Task 3: Minimal Init Output

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/tests/init.test.ts`

**Interfaces:**
- Consumes: existing `executeInit(skillName, options)`.
- Produces: same `executeInit` signature and return value, but the generated directory contains only `skill.json` and `SKILL.md`.

- [ ] **Step 1: Update failing init test expectations**

Modify `packages/cli/tests/init.test.ts` in the minimal package test:

```ts
expect(fs.existsSync(path.join(targetDir, 'skill.json'))).toBe(true);
expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
expect(fs.existsSync(path.join(targetDir, 'scripts'))).toBe(false);
expect(fs.existsSync(path.join(targetDir, 'references'))).toBe(false);
expect(fs.existsSync(path.join(targetDir, 'assets'))).toBe(false);
expect(fs.existsSync(path.join(targetDir, 'resources'))).toBe(false);
```

- [ ] **Step 2: Run init test to verify failure**

Run:

```powershell
npm test -- --run packages/cli/tests/init.test.ts
```

Expected: FAIL because `executeInit` still creates optional directories.

- [ ] **Step 3: Remove optional directory creation from init**

Modify `packages/cli/src/commands/init.ts` by deleting these lines:

```ts
await fs.mkdir(path.join(targetDir, 'scripts'));
await fs.mkdir(path.join(targetDir, 'references'));
await fs.mkdir(path.join(targetDir, 'assets'));
```

Keep the rest of the function unchanged.

- [ ] **Step 4: Run init test**

Run:

```powershell
npm test -- --run packages/cli/tests/init.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add packages/cli/src/commands/init.ts packages/cli/tests/init.test.ts
git commit -m "feat(cli): initialize minimal skill packages"
```

---

### Task 4: Final Verification

**Files:**
- No planned source changes. Fix only failures caused by Tasks 1-3.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified repository state.

- [ ] **Step 1: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 2: Run full build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 3: Inspect changed files**

Run:

```powershell
git status --short
```

Expected: only intentional implementation files are modified or untracked.

- [ ] **Step 4: Commit any verification fixes**

If Step 1 or Step 2 required fixes, commit them:

```powershell
git add <fixed-files>
git commit -m "test: stabilize skill import workflow"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers `import` default namespace, explicit namespace, no `--name`, no overwrite, no rename, install into the current project, default adapt, `--no-adapt`, and minimal `init`.
- Placeholder scan: No unresolved implementation placeholders are present.
- Type consistency: `prepareSkillImport` returns `skillName`, `directory`, and `createdSkillJson`; `executeImport` consumes those names and returns `sourceDir`, `targetDir`, `skillName`, and `createdSkillJson`.
