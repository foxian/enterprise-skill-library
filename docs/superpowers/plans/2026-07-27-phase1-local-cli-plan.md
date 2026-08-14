# Phase 1: Local CLI & Core Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 local development foundation for ESL: monorepo scaffolding, ESL package metadata validation, `SKILL.md` runtime validation, local store initialization, and the `esl init`, `esl validate`, and `esl version` CLI commands.

**Architecture:** npm workspace monorepo with `packages/core` and `packages/cli`. `@esl/core` owns all reusable validation, local store, and version logic. `@esl/cli` owns Commander command wiring, terminal output, and exit behavior.

**Tech Stack:** Node.js >= 18.0.0, npm workspaces, TypeScript strict ESM, Commander.js, Zod, yaml, Vitest.

## Global Constraints

- Node.js >= 18.0.0
- Package Manager: npm workspaces
- Code Style: Strict TypeScript, ESM modules
- Spec reference: `docs/specs/2026-07-27-enterprise-skill-library-design.md`
- `skill.json` is ESL package metadata; `SKILL.md` frontmatter is Agent runtime trigger metadata.
- Runtime skill resources use `scripts/`, `references/`, and `assets/`; `resources/` is deprecated and should be reported by validation.
- `README.md`, `CHANGELOG.md`, `agents/openai.yaml`, and `evals/` are optional package/documentation enhancements, not Phase 1 required runtime files.

---

### Task 1: Monorepo, Core, and CLI Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/tests/index.test.ts`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/tests/index.test.ts`

**Interfaces:**
- Produces: npm workspace with buildable `@esl/core` and `@esl/cli` packages.
- Produces: `@esl/core.VERSION = '0.1.0'`.

- [ ] **Step 1: Write failing package sanity tests**

```typescript
// packages/core/tests/index.test.ts
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('@esl/core', () => {
  it('exports the package version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

```typescript
// packages/cli/tests/index.test.ts
import { describe, expect, it } from 'vitest';
import { CLI_NAME } from '../src/index.js';

describe('@esl/cli', () => {
  it('exports the CLI name', () => {
    expect(CLI_NAME).toBe('esl');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run packages/core/tests/index.test.ts packages/cli/tests/index.test.ts`

Expected: FAIL because package source files do not exist.

- [ ] **Step 3: Add workspace configuration**

```json
// package.json
{
  "name": "enterprise-skill-library-monorepo",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  }
}
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 4: Add package manifests and tsconfigs**

```json
// packages/core/package.json
{
  "name": "@esl/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "yaml": "^2.3.4",
    "zod": "^3.22.4"
  }
}
```

```json
// packages/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

```json
// packages/cli/package.json
{
  "name": "@esl/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "esl": "./dist/bin/esl.js"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@esl/core": "*",
    "commander": "^11.1.0"
  }
}
```

```json
// packages/cli/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Add minimal source files**

```typescript
// packages/core/src/index.ts
export const VERSION = '0.1.0';
```

```typescript
// packages/cli/src/index.ts
export const CLI_NAME = 'esl';
```

- [ ] **Step 6: Install dependencies and verify**

Run: `npm install`

Expected: PASS and creates `package-lock.json`.

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json packages/core packages/cli
git commit -m "chore: setup ESL monorepo packages"
```

---

### Task 2: `skill.json` Schema and Validator

**Files:**
- Create: `packages/core/src/schema/skill-json.ts`
- Create: `packages/core/src/schema/validation-result.ts`
- Create: `packages/core/tests/skill-json.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `validateSkillJson(data: unknown): ValidationResult<SkillJson>`.
- Produces: `parseSkillName(name: string): { scope: string; skillName: string }`.

- [ ] **Step 1: Write failing schema tests**

```typescript
// packages/core/tests/skill-json.test.ts
import { describe, expect, it } from 'vitest';
import { parseSkillName, validateSkillJson } from '../src/index.js';

describe('skill.json validation', () => {
  it('accepts valid ESL package metadata', () => {
    const result = validateSkillJson({
      name: '@myorg/debugging-helper',
      version: '1.2.0',
      description: 'Systematic debugging skill',
      author: 'zhangsan',
      license: 'MIT',
      keywords: ['debugging', 'testing'],
      compatibility: {
        tools: ['codex', 'claude-code'],
        languages: ['typescript']
      },
      dependencies: {
        '@myorg/test-utils': '^1.0.0'
      },
      repository: 'git@skills.company.com:myorg/debugging-helper.git'
    });

    expect(result.success).toBe(true);
  });

  it('rejects unscoped skill names', () => {
    const result = validateSkillJson({
      name: 'debugging-helper',
      version: '1.2.0',
      description: 'Systematic debugging skill',
      author: 'zhangsan'
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid versions and empty descriptions', () => {
    const result = validateSkillJson({
      name: '@myorg/debugging-helper',
      version: '1.2',
      description: '',
      author: 'zhangsan'
    });

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('version'),
        expect.stringContaining('description')
      ])
    );
  });

  it('parses scoped skill names', () => {
    expect(parseSkillName('@frontend-team/react-component-gen')).toEqual({
      scope: 'frontend-team',
      skillName: 'react-component-gen'
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/core/tests/skill-json.test.ts`

Expected: FAIL because schema functions do not exist.

- [ ] **Step 3: Implement validation result type**

```typescript
// packages/core/src/schema/validation-result.ts
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };
```

- [ ] **Step 4: Implement `skill.json` schema**

```typescript
// packages/core/src/schema/skill-json.ts
import { z } from 'zod';
import type { ValidationResult } from './validation-result.js';

export const SkillNameSchema = z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/, {
  message: 'Skill name must follow @scope/skill-name using lowercase letters, digits, and hyphens'
});

export const SemVerSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, {
  message: 'Version must be valid SemVer such as 1.0.0'
});

export const SkillJsonSchema = z.object({
  name: SkillNameSchema,
  version: SemVerSchema,
  description: z.string().min(1).max(1024),
  author: z.string().min(1),
  license: z.string().optional(),
  keywords: z.array(z.string().min(1)).optional(),
  compatibility: z
    .object({
      tools: z.array(z.string().min(1)).optional(),
      languages: z.array(z.string().min(1)).optional()
    })
    .optional(),
  dependencies: z.record(SkillNameSchema, z.string().min(1)).optional(),
  repository: z.string().min(1).optional()
});

export type SkillJson = z.infer<typeof SkillJsonSchema>;

export function validateSkillJson(data: unknown): ValidationResult<SkillJson> {
  const result = SkillJsonSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'skill.json';
      return `${path}: ${issue.message}`;
    })
  };
}

export function parseSkillName(name: string): { scope: string; skillName: string } {
  const result = SkillNameSchema.safeParse(name);
  if (!result.success) {
    throw new Error('Skill name must follow @scope/skill-name using lowercase letters, digits, and hyphens');
  }

  const [scope, skillName] = name.slice(1).split('/');
  return { scope, skillName };
}
```

- [ ] **Step 5: Re-export schema APIs**

```typescript
// packages/core/src/index.ts
export const VERSION = '0.1.0';

export * from './schema/skill-json.js';
export * from './schema/validation-result.js';
```

- [ ] **Step 6: Verify**

Run: `npx vitest run packages/core/tests/skill-json.test.ts`

Expected: PASS.

Run: `npm run build --workspace @esl/core`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add ESL skill metadata validation"
```

---

### Task 3: `SKILL.md` and Skill Directory Validation

**Files:**
- Create: `packages/core/src/skill/skill-md.ts`
- Create: `packages/core/src/skill/directory-validator.ts`
- Create: `packages/core/tests/skill-directory.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `validateSkillJson()` and `parseSkillName()`.
- Produces: `validateSkillMd(content: string): ValidationResult<SkillMdMetadata>`.
- Produces: `validateSkillDirectory(directory: string): Promise<ValidationResult<SkillDirectory>>`.

- [ ] **Step 1: Write failing directory validation tests**

```typescript
// packages/core/tests/skill-directory.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateSkillDirectory, validateSkillMd } from '../src/index.js';

describe('SKILL.md validation', () => {
  it('accepts required frontmatter fields', () => {
    const result = validateSkillMd(`---
name: debugging-helper
description: Use when debugging failures, test regressions, stack traces, or unexplained behavior.
---

# Debugging Helper
`);

    expect(result.success).toBe(true);
  });

  it('rejects missing descriptions', () => {
    const result = validateSkillMd(`---
name: debugging-helper
---

# Debugging Helper
`);

    expect(result.success).toBe(false);
  });
});

describe('skill directory validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-skill-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a minimal runtime skill package', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/debugging-helper',
        version: '0.1.0',
        description: 'Systematic debugging skill',
        author: 'zhangsan'
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'SKILL.md'),
      `---
name: debugging-helper
description: Use when debugging failures, test regressions, stack traces, or unexplained behavior.
---

# Debugging Helper
`
    );
    fs.mkdirSync(path.join(tmpDir, 'scripts'));
    fs.mkdirSync(path.join(tmpDir, 'references'));
    fs.mkdirSync(path.join(tmpDir, 'assets'));

    const result = await validateSkillDirectory(tmpDir);

    expect(result.success).toBe(true);
  });

  it('reports deprecated resources directory', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/debugging-helper',
        version: '0.1.0',
        description: 'Systematic debugging skill',
        author: 'zhangsan'
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'SKILL.md'),
      `---
name: debugging-helper
description: Use when debugging failures, test regressions, stack traces, or unexplained behavior.
---

# Debugging Helper
`
    );
    fs.mkdirSync(path.join(tmpDir, 'resources'));

    const result = await validateSkillDirectory(tmpDir);

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('resources')])
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/core/tests/skill-directory.test.ts`

Expected: FAIL because skill directory validators do not exist.

- [ ] **Step 3: Implement `SKILL.md` frontmatter parser**

```typescript
// packages/core/src/skill/skill-md.ts
import YAML from 'yaml';
import { z } from 'zod';
import type { ValidationResult } from '../schema/validation-result.js';

const SkillMdMetadataSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,64}$/, {
    message: 'SKILL.md name must use lowercase letters, digits, and hyphens'
  }),
  description: z.string().min(1).max(1024)
});

export type SkillMdMetadata = z.infer<typeof SkillMdMetadataSchema>;

export function validateSkillMd(content: string): ValidationResult<SkillMdMetadata> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { success: false, errors: ['SKILL.md: missing YAML frontmatter'] };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1]);
  } catch (error) {
    return { success: false, errors: [`SKILL.md: invalid YAML frontmatter: ${(error as Error).message}`] };
  }

  const result = SkillMdMetadataSchema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'frontmatter';
      return `SKILL.md ${path}: ${issue.message}`;
    })
  };
}
```

- [ ] **Step 4: Implement directory validator**

```typescript
// packages/core/src/skill/directory-validator.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName, validateSkillJson, type SkillJson } from '../schema/skill-json.js';
import type { ValidationResult } from '../schema/validation-result.js';
import { validateSkillMd, type SkillMdMetadata } from './skill-md.js';

export interface SkillDirectory {
  directory: string;
  skillJson: SkillJson;
  skillMd: SkillMdMetadata;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function validateSkillDirectory(directory: string): Promise<ValidationResult<SkillDirectory>> {
  const errors: string[] = [];
  const skillJsonPath = path.join(directory, 'skill.json');
  const skillMdPath = path.join(directory, 'SKILL.md');

  if (!(await exists(skillJsonPath))) {
    errors.push('skill.json: file is required');
  }
  if (!(await exists(skillMdPath))) {
    errors.push('SKILL.md: file is required');
  }
  if (await exists(path.join(directory, 'resources'))) {
    errors.push('resources/: deprecated; use assets/ for runtime assets');
  }

  let skillJson: SkillJson | undefined;
  let skillMd: SkillMdMetadata | undefined;

  if (await exists(skillJsonPath)) {
    try {
      const raw = await fs.readFile(skillJsonPath, 'utf8');
      const validation = validateSkillJson(JSON.parse(raw));
      if (validation.success) {
        skillJson = validation.data;
      } else {
        errors.push(...validation.errors);
      }
    } catch (error) {
      errors.push(`skill.json: ${(error as Error).message}`);
    }
  }

  if (await exists(skillMdPath)) {
    const validation = validateSkillMd(await fs.readFile(skillMdPath, 'utf8'));
    if (validation.success) {
      skillMd = validation.data;
    } else {
      errors.push(...validation.errors);
    }
  }

  if (skillJson && skillMd) {
    const { skillName } = parseSkillName(skillJson.name);
    if (skillMd.name !== skillName) {
      errors.push(`SKILL.md name must match skill.json name suffix "${skillName}"`);
    }
  }

  if (errors.length > 0 || !skillJson || !skillMd) {
    return { success: false, errors };
  }

  return { success: true, data: { directory, skillJson, skillMd } };
}
```

- [ ] **Step 5: Re-export skill validation APIs**

```typescript
// packages/core/src/index.ts
export const VERSION = '0.1.0';

export * from './schema/skill-json.js';
export * from './schema/validation-result.js';
export * from './skill/directory-validator.js';
export * from './skill/skill-md.js';
```

- [ ] **Step 6: Verify**

Run: `npx vitest run packages/core/tests/skill-directory.test.ts`

Expected: PASS.

Run: `npm run build --workspace @esl/core`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): validate runtime skill directories"
```

---

### Task 4: Local Store Initialization

**Files:**
- Create: `packages/core/src/store/local-store.ts`
- Create: `packages/core/tests/local-store.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `resolveLocalStorePaths(options?: { homeDir?: string }): LocalStorePaths`.
- Produces: `initializeLocalStore(options?: { homeDir?: string }): Promise<LocalStorePaths>`.

- [ ] **Step 1: Write failing local store tests**

```typescript
// packages/core/tests/local-store.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeLocalStore, resolveLocalStorePaths } from '../src/index.js';

describe('local store', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-home-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('resolves paths under ~/.skill-library', () => {
    const paths = resolveLocalStorePaths({ homeDir });

    expect(paths.root).toBe(path.join(homeDir, '.skill-library'));
    expect(paths.configJson).toBe(path.join(homeDir, '.skill-library', 'config.json'));
    expect(paths.credentialsJson).toBe(path.join(homeDir, '.skill-library', 'credentials.json'));
    expect(paths.cacheDir).toBe(path.join(homeDir, '.skill-library', 'cache'));
    expect(paths.skillsDir).toBe(path.join(homeDir, '.skill-library', 'skills'));
  });

  it('initializes directories and default JSON files', async () => {
    const paths = await initializeLocalStore({ homeDir });

    expect(fs.existsSync(paths.cacheDir)).toBe(true);
    expect(fs.existsSync(paths.skillsDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(paths.configJson, 'utf8'))).toEqual({
      registry: null,
      tools: [],
      user: null
    });
    expect(JSON.parse(fs.readFileSync(paths.credentialsJson, 'utf8'))).toEqual({
      api_token: null,
      ssh_key_path: null
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/core/tests/local-store.test.ts`

Expected: FAIL because local store APIs do not exist.

- [ ] **Step 3: Implement local store APIs**

```typescript
// packages/core/src/store/local-store.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface LocalStorePaths {
  root: string;
  configJson: string;
  credentialsJson: string;
  cacheDir: string;
  skillsDir: string;
}

export interface LocalStoreOptions {
  homeDir?: string;
}

export function resolveLocalStorePaths(options: LocalStoreOptions = {}): LocalStorePaths {
  const homeDir = options.homeDir ?? os.homedir();
  const root = path.join(homeDir, '.skill-library');
  return {
    root,
    configJson: path.join(root, 'config.json'),
    credentialsJson: path.join(root, 'credentials.json'),
    cacheDir: path.join(root, 'cache'),
    skillsDir: path.join(root, 'skills')
  };
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

export async function initializeLocalStore(options: LocalStoreOptions = {}): Promise<LocalStorePaths> {
  const paths = resolveLocalStorePaths(options);

  await fs.mkdir(paths.cacheDir, { recursive: true });
  await fs.mkdir(paths.skillsDir, { recursive: true });
  await writeJsonIfMissing(paths.configJson, {
    registry: null,
    tools: [],
    user: null
  });
  await writeJsonIfMissing(paths.credentialsJson, {
    api_token: null,
    ssh_key_path: null
  });

  return paths;
}
```

- [ ] **Step 4: Re-export local store APIs**

```typescript
// packages/core/src/index.ts
export const VERSION = '0.1.0';

export * from './schema/skill-json.js';
export * from './schema/validation-result.js';
export * from './skill/directory-validator.js';
export * from './skill/skill-md.js';
export * from './store/local-store.js';
```

- [ ] **Step 5: Verify**

Run: `npx vitest run packages/core/tests/local-store.test.ts`

Expected: PASS.

Run: `npm run build --workspace @esl/core`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): initialize ESL local store"
```

---

### Task 5: `esl init` Command

**Files:**
- Create: `packages/cli/src/commands/init.ts`
- Create: `packages/cli/tests/init.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `parseSkillName()` and `validateSkillDirectory()`.
- Produces: `executeInit(skillName: string, options?: { cwd?: string; runGitInit?: boolean }): Promise<string>`.

- [ ] **Step 1: Write failing init command tests**

```typescript
// packages/cli/tests/init.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit } from '../src/index.js';

describe('esl init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a minimal runtime skill package', async () => {
    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false
    });

    expect(targetDir).toBe(path.join(tmpDir, 'my-skill'));
    expect(fs.existsSync(path.join(targetDir, 'skill.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'scripts'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'references'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'assets'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'resources'))).toBe(false);

    const skillJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'skill.json'), 'utf8'));
    expect(skillJson.name).toBe('@myorg/my-skill');
    expect(skillJson.version).toBe('0.1.0');

    const skillMd = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: my-skill');
    expect(skillMd).toContain('description: Use when');
  });

  it('rejects invalid skill names', async () => {
    await expect(executeInit('my-skill', { cwd: tmpDir, runGitInit: false })).rejects.toThrow(
      '@scope/skill-name'
    );
  });

  it('does not overwrite existing directories', async () => {
    fs.mkdirSync(path.join(tmpDir, 'my-skill'));

    await expect(executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false })).rejects.toThrow(
      'already exists'
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/cli/tests/init.test.ts`

Expected: FAIL because `executeInit` does not exist.

- [ ] **Step 3: Implement init command logic**

```typescript
// packages/cli/src/commands/init.ts
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSkillName, validateSkillDirectory } from '@esl/core';

const execFileAsync = promisify(execFile);

export interface InitOptions {
  cwd?: string;
  runGitInit?: boolean;
}

export async function executeInit(skillName: string, options: InitOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const runGitInit = options.runGitInit ?? true;
  const { skillName: folderName } = parseSkillName(skillName);
  const targetDir = path.join(cwd, folderName);

  try {
    await fs.access(targetDir);
    throw new Error(`Directory ${folderName} already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(path.join(targetDir, 'scripts'));
  await fs.mkdir(path.join(targetDir, 'references'));
  await fs.mkdir(path.join(targetDir, 'assets'));

  const skillJson = {
    name: skillName,
    version: '0.1.0',
    description: `Runtime skill package for ${folderName}`,
    author: process.env.USER ?? process.env.USERNAME ?? 'anonymous',
    keywords: []
  };

  await fs.writeFile(path.join(targetDir, 'skill.json'), `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(targetDir, 'SKILL.md'),
    `---
name: ${folderName}
description: Use when a user needs the ${folderName} workflow or domain guidance.
---

# ${folderName}

Write concise agent instructions here. Move long reference material into references/, reusable scripts into scripts/, and output templates or assets into assets/.
`,
    'utf8'
  );

  const validation = await validateSkillDirectory(targetDir);
  if (!validation.success) {
    throw new Error(`Generated invalid skill package: ${validation.errors.join(', ')}`);
  }

  if (runGitInit) {
    await execFileAsync('git', ['init'], { cwd: targetDir });
  }

  return targetDir;
}
```

- [ ] **Step 4: Re-export init command**

```typescript
// packages/cli/src/index.ts
export const CLI_NAME = 'esl';

export * from './commands/init.js';
```

- [ ] **Step 5: Verify**

Run: `npx vitest run packages/cli/tests/init.test.ts`

Expected: PASS.

Run: `npm run build --workspace @esl/cli`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): initialize minimal ESL skill packages"
```

---

### Task 6: `esl validate`, `esl version`, and CLI Entrypoint

**Files:**
- Create: `packages/core/src/version/version.ts`
- Create: `packages/core/tests/version.test.ts`
- Create: `packages/cli/src/commands/validate.ts`
- Create: `packages/cli/src/commands/version.ts`
- Create: `packages/cli/src/bin/esl.ts`
- Create: `packages/cli/tests/validate.test.ts`
- Create: `packages/cli/tests/version-command.test.ts`
- Create: `packages/cli/tests/bin.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Produces: `bumpSkillVersion(directory: string, release: 'major' | 'minor' | 'patch'): Promise<string>`.
- Produces: `executeValidate(directory?: string): Promise<{ valid: boolean; errors: string[] }>`
- Produces: `executeVersion(release: ReleaseType, options?: { cwd?: string }): Promise<string>`.
- Produces: executable `esl` CLI with `init`, `validate [path]`, and `version <major|minor|patch>`.

- [ ] **Step 1: Write failing version tests**

```typescript
// packages/core/tests/version.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bumpSkillVersion } from '../src/index.js';

describe('skill version bumping', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-'));
    fs.writeFileSync(
      path.join(tmpDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/my-skill',
        version: '1.2.3',
        description: 'My skill',
        author: 'zhangsan'
      })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bumps patch versions', async () => {
    await expect(bumpSkillVersion(tmpDir, 'patch')).resolves.toBe('1.2.4');
  });

  it('bumps minor versions and resets patch', async () => {
    await expect(bumpSkillVersion(tmpDir, 'minor')).resolves.toBe('1.3.0');
  });

  it('bumps major versions and resets minor and patch', async () => {
    await expect(bumpSkillVersion(tmpDir, 'major')).resolves.toBe('2.0.0');
  });
});
```

- [ ] **Step 2: Write failing CLI command tests**

```typescript
// packages/cli/tests/validate.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit, executeValidate } from '../src/index.js';

describe('esl validate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-validate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports valid generated skill packages', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });

    await expect(executeValidate(skillDir)).resolves.toEqual({ valid: true, errors: [] });
  });

  it('reports invalid skill packages', async () => {
    const result = await executeValidate(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('skill.json')]));
  });
});
```

```typescript
// packages/cli/tests/version-command.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit, executeVersion } from '../src/index.js';

describe('esl version', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-command-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bumps the current skill package version', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });

    await expect(executeVersion('minor', { cwd: skillDir })).resolves.toBe('0.2.0');
  });
});
```

```typescript
// packages/cli/tests/bin.test.ts
import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/bin/esl.js';

describe('esl program', () => {
  it('registers Phase 1 commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(expect.arrayContaining(['init', 'validate', 'version']));
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npx vitest run packages/core/tests/version.test.ts packages/cli/tests/validate.test.ts packages/cli/tests/version-command.test.ts packages/cli/tests/bin.test.ts`

Expected: FAIL because version and CLI command APIs do not exist.

- [ ] **Step 4: Implement core version bumping**

```typescript
// packages/core/src/version/version.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateSkillJson, type SkillJson } from '../schema/skill-json.js';

export type ReleaseType = 'major' | 'minor' | 'patch';

function nextVersion(current: string, release: ReleaseType): string {
  const [major, minor, patch] = current.split('.').map(Number);
  if (release === 'major') {
    return `${major + 1}.0.0`;
  }
  if (release === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export async function bumpSkillVersion(directory: string, release: ReleaseType): Promise<string> {
  const skillJsonPath = path.join(directory, 'skill.json');
  const raw = await fs.readFile(skillJsonPath, 'utf8');
  const data = JSON.parse(raw) as SkillJson;
  const validation = validateSkillJson(data);
  if (!validation.success) {
    throw new Error(`Cannot bump invalid skill.json: ${validation.errors.join(', ')}`);
  }

  const version = nextVersion(validation.data.version, release);
  await fs.writeFile(skillJsonPath, `${JSON.stringify({ ...validation.data, version }, null, 2)}\n`, 'utf8');
  return version;
}
```

- [ ] **Step 5: Implement CLI command wrappers**

```typescript
// packages/cli/src/commands/validate.ts
import { validateSkillDirectory } from '@esl/core';

export async function executeValidate(directory = process.cwd()): Promise<{ valid: boolean; errors: string[] }> {
  const result = await validateSkillDirectory(directory);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: result.errors };
}
```

```typescript
// packages/cli/src/commands/version.ts
import { bumpSkillVersion, type ReleaseType } from '@esl/core';

export async function executeVersion(
  release: ReleaseType,
  options: { cwd?: string } = {}
): Promise<string> {
  return bumpSkillVersion(options.cwd ?? process.cwd(), release);
}
```

- [ ] **Step 6: Implement Commander entrypoint**

```typescript
// packages/cli/src/bin/esl.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { executeInit } from '../commands/init.js';
import { executeValidate } from '../commands/validate.js';
import { executeVersion } from '../commands/version.js';

export function createProgram(): Command {
  const program = new Command();

  program.name('esl').description('Enterprise Skill Library CLI').version('0.1.0');

  program
    .command('init')
    .argument('<skill-name>')
    .action(async (skillName: string) => {
      const targetDir = await executeInit(skillName);
      console.log(`Skill initialized at ${targetDir}`);
    });

  program
    .command('validate')
    .argument('[path]', 'skill directory', process.cwd())
    .action(async (directory: string) => {
      const result = await executeValidate(directory);
      if (result.valid) {
        console.log('Skill package is valid');
        return;
      }
      for (const error of result.errors) {
        console.error(error);
      }
      process.exitCode = 1;
    });

  program
    .command('version')
    .argument('<release>', 'major, minor, or patch')
    .action(async (release: string) => {
      if (release !== 'major' && release !== 'minor' && release !== 'patch') {
        console.error('release must be major, minor, or patch');
        process.exitCode = 1;
        return;
      }
      const version = await executeVersion(release);
      console.log(version);
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await createProgram().parseAsync(process.argv);
}
```

- [ ] **Step 7: Re-export final APIs**

```typescript
// packages/core/src/index.ts
export const VERSION = '0.1.0';

export * from './schema/skill-json.js';
export * from './schema/validation-result.js';
export * from './skill/directory-validator.js';
export * from './skill/skill-md.js';
export * from './store/local-store.js';
export * from './version/version.js';
```

```typescript
// packages/cli/src/index.ts
export const CLI_NAME = 'esl';

export * from './commands/init.js';
export * from './commands/validate.js';
export * from './commands/version.js';
```

- [ ] **Step 8: Verify**

Run: `npx vitest run packages/core/tests/version.test.ts packages/cli/tests/validate.test.ts packages/cli/tests/version-command.test.ts packages/cli/tests/bin.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core packages/cli
git commit -m "feat(cli): add validate and version commands"
```

---

## Plan Review Self-Check

1. **Spec Coverage:** Covers the full Phase 1 scope in `docs/specs/2026-07-27-enterprise-skill-library-design.md`: monorepo, `skill.json`, `SKILL.md`, local store, `esl init`, `esl validate`, and `esl version`.
2. **Skill-Creation Alignment:** Uses `assets/` instead of deprecated `resources/`, keeps `SKILL.md` frontmatter to runtime trigger fields, and treats `README.md` / `CHANGELOG.md` as optional package documentation.
3. **Type Consistency:** Core APIs are exported from `@esl/core`; CLI command wrappers consume those APIs and expose testable `execute*` functions.
4. **Testability:** Each task has a failing test, implementation, verification command, and commit.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-07-27-phase1-local-cli-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.
