# `esl unlink` 目录推导 Skill Identity 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `esl unlink` 在省略参数、`.` 或显式技能目录路径时，从该目录的 `release.json` 推导 Skill Identity，再按既有语义解除 Skill Source Link；显式 `@scope/name` 行为不变。

**Architecture:** 在 `packages/cli` 增加纯解析函数 `resolveUnlinkIdentity`（目录 / `@identity` → 身份），由 `executeUnlink` 在改 Store 之前调用；再用 Install Manifest 做「源路径身份不一致」专用错误与「项目级裸 unlink 脚枪」提示。`projectRoot` 始终来自调用 cwd（含 `-C`），位置路径只用于读 `release.json`，不向上查找 `.eslib`。不改 `packages/core` 领域模型。

**Tech Stack:** TypeScript、Commander、Vitest、现有 `@esl/core`（`validateReleaseManifest`、`loadInstallManifest`、`parseSkillName`）。

**Spec:** `docs/superpowers/specs/2026-09-25-esl-unlink-directory-identity-design.md`（已冻结）

## Global Constraints

- 与用户沟通、代码注释、提交说明、`esl-operator` 文档使用简体中文；CLI 抛错文案与现有 `unlink` 英文风格保持一致（可含中文文档已说明的语义）。
- 目录输入只是 CLI 糖衣；领域操作仍是按 Skill Identity 解除 Skill Source Link。
- 非 `@` 参数一律当路径；裸短名 `release.json.name` → `@local/<短名>`。
- 目录内省略**正式承诺** `--global`；项目级须在项目根使用 `./path` 或显式身份。
- `projectRoot` = cwd / `-C` 后的 cwd；技能目录路径绝不移动 projectRoot，不向上找项目根。
- 任何解析失败、专用错误、脚枪提示必须发生在 Store 变更之前。
- 同步更新 `skills/esl-operator/`；改完跑 `npm test` 与 `npm run build`。
- 每个行为先写失败测试并确认失败，再写最小实现。
- YAGNI：不扩展 `uninstall`；不导出 core 新领域类型；不改 ADR-0042（除非帮助实在说不清再另议）。

## File Structure

| 文件 | 职责 |
|---|---|
| `packages/cli/src/commands/resolve-unlink-identity.ts` | 将 `undefined` / `.` / 路径 / `@identity` 解析为 `{ identity, fromDirectory, skillDir, usedOmitOrDot }` |
| `packages/cli/src/commands/unlink.ts` | 调用解析；身份不一致专用错误；项目级裸 unlink 脚枪提示；既有解除逻辑 |
| `packages/cli/src/bin/esl.ts` | `unlink` 参数改为可选；help 示例按规格主推顺序 |
| `packages/cli/tests/resolve-unlink-identity.test.ts` | 解析层单测 |
| `packages/cli/tests/link.test.ts` | 扩展 `esl unlink` 集成行为（目录糖衣、专用错误、脚枪、`--global` 隔离） |
| `skills/esl-operator/references/consumer.md` | 与 CLI 锁步的操作说明 |

---

### Task 1: `resolveUnlinkIdentity` 解析层

**Files:**
- Create: `packages/cli/src/commands/resolve-unlink-identity.ts`
- Test: `packages/cli/tests/resolve-unlink-identity.test.ts`

**Interfaces:**
- Consumes: `validateReleaseManifest`、`fileExists`（均来自 `@esl/core`）；Node `fs/promises`、`path`
- Produces:

```ts
export interface ResolveUnlinkIdentityOptions {
  /** 默认 process.cwd()；测试可注入，避免依赖 chdir */
  cwd?: string;
}

export interface ResolvedUnlinkTarget {
  identity: string;
  /** 是否从技能目录的 release.json 推导（含省略 / . / 路径） */
  fromDirectory: boolean;
  /** 推导时使用的绝对技能目录；显式 @identity 时为 null */
  skillDir: string | null;
  /** 调用方传入 undefined 或 '.'（脚枪提示用） */
  usedOmitOrDot: boolean;
}

export async function resolveUnlinkIdentity(
  target: string | undefined,
  options?: ResolveUnlinkIdentityOptions
): Promise<ResolvedUnlinkTarget>;
```

- [ ] **Step 1: Write the failing test**

在 `packages/cli/tests/resolve-unlink-identity.test.ts` 写入（可按仓库既有 tmpdir 风格整理）：

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveUnlinkIdentity } from '../src/commands/resolve-unlink-identity.js';

function writeRelease(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'release.json'),
    JSON.stringify({
      schemaVersion: 3,
      name,
      version: '1.0.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    })
  );
}

describe('resolveUnlinkIdentity', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-unlink-resolve-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('treats @scope/name as an explicit identity', async () => {
    await expect(resolveUnlinkIdentity('@forg/markdown-master', { cwd: root })).resolves.toEqual({
      identity: '@forg/markdown-master',
      fromDirectory: false,
      skillDir: null,
      usedOmitOrDot: false
    });
  });

  it('reads release.json from cwd when target is omitted', async () => {
    writeRelease(root, '@forg/markdown-master');
    await expect(resolveUnlinkIdentity(undefined, { cwd: root })).resolves.toMatchObject({
      identity: '@forg/markdown-master',
      fromDirectory: true,
      skillDir: path.resolve(root),
      usedOmitOrDot: true
    });
  });

  it('treats "." like an omitted target', async () => {
    writeRelease(root, '@forg/markdown-master');
    await expect(resolveUnlinkIdentity('.', { cwd: root })).resolves.toMatchObject({
      identity: '@forg/markdown-master',
      usedOmitOrDot: true,
      fromDirectory: true
    });
  });

  it('reads release.json from an explicit relative path without changing semantic cwd', async () => {
    const skillDir = path.join(root, 'skills', 'markdown-master');
    writeRelease(skillDir, '@forg/markdown-master');
    await expect(resolveUnlinkIdentity('./skills/markdown-master', { cwd: root })).resolves.toMatchObject({
      identity: '@forg/markdown-master',
      fromDirectory: true,
      skillDir: path.resolve(skillDir),
      usedOmitOrDot: false
    });
  });

  it('completes a bare release.json name as @local/<short-name>', async () => {
    writeRelease(root, 'draft-skill');
    await expect(resolveUnlinkIdentity(undefined, { cwd: root })).resolves.toMatchObject({
      identity: '@local/draft-skill'
    });
  });

  it('rejects a non-@ token that is not a usable skill directory', async () => {
    await expect(resolveUnlinkIdentity('markdown-master', { cwd: root })).rejects.toThrow(
      /release\.json|skill directory|@scope\/skill-name/i
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/resolve-unlink-identity.test.ts`

Expected: FAIL（模块不存在或导出缺失）。

- [ ] **Step 3: Write minimal implementation**

创建 `packages/cli/src/commands/resolve-unlink-identity.ts`：

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileExists, validateReleaseManifest } from '@esl/core';

export interface ResolveUnlinkIdentityOptions {
  cwd?: string;
}

export interface ResolvedUnlinkTarget {
  identity: string;
  fromDirectory: boolean;
  skillDir: string | null;
  usedOmitOrDot: boolean;
}

function completeBareIdentity(name: string): string {
  if (name.startsWith('@')) {
    return name;
  }
  return `@local/${name}`;
}

async function identityFromSkillDir(skillDir: string): Promise<string> {
  const releasePath = path.join(skillDir, 'release.json');
  if (!(await fileExists(releasePath))) {
    throw new Error(
      `Cannot infer skill identity from ${skillDir}: release.json is missing; pass @scope/skill-name explicitly`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(releasePath, 'utf8'));
  } catch {
    throw new Error(
      `Cannot infer skill identity from ${skillDir}: release.json is not valid JSON; pass @scope/skill-name explicitly`
    );
  }
  const validation = validateReleaseManifest(parsed);
  if (!validation.success) {
    throw new Error(
      `Cannot infer skill identity from ${skillDir}: ${validation.errors.join(', ')}; pass @scope/skill-name explicitly`
    );
  }
  return completeBareIdentity(validation.data.name);
}

export async function resolveUnlinkIdentity(
  target: string | undefined,
  options: ResolveUnlinkIdentityOptions = {}
): Promise<ResolvedUnlinkTarget> {
  const cwd = options.cwd ?? process.cwd();

  if (typeof target === 'string' && target.startsWith('@')) {
    return {
      identity: target,
      fromDirectory: false,
      skillDir: null,
      usedOmitOrDot: false
    };
  }

  const usedOmitOrDot = target === undefined || target === '.';
  const skillDir = usedOmitOrDot ? path.resolve(cwd) : path.resolve(cwd, target);
  const identity = await identityFromSkillDir(skillDir);
  return {
    identity,
    fromDirectory: true,
    skillDir,
    usedOmitOrDot
  };
}
```

注意：`target` 为其他字符串时走路径分支（含 `markdown-master`）；不要 `parseSkillName` 短名回退。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/resolve-unlink-identity.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/resolve-unlink-identity.ts packages/cli/tests/resolve-unlink-identity.test.ts
git commit -m "feat(cli): 解析 unlink 的目录或显式身份参数"
```

---

### Task 2: `executeUnlink` 接入解析、专用错误与脚枪提示

**Files:**
- Modify: `packages/cli/src/commands/unlink.ts`
- Modify: `packages/cli/tests/link.test.ts`（`describe('esl unlink')` 内追加用例）

**Interfaces:**
- Consumes: `resolveUnlinkIdentity`（Task 1）；现有 `loadInstallManifest` / `unlinkSkillDirectory` 等
- Produces: 更新后的

```ts
export interface UnlinkOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  /** 仅用于解析技能目录；默认 process.cwd()。不等于改变项目根语义之外的额外根 */
  cwd?: string;
}

export async function executeUnlink(
  target: string | undefined,
  options?: UnlinkOptions
): Promise<UnlinkResult>;
// UnlinkResult.identity 仍为最终解除的身份
```

路径比较（与 core link 私有 `samePath` 对齐，本地私有函数即可，勿为小事改 core 导出）：

```ts
function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
```

- [ ] **Step 1: Write the failing tests**

在 `packages/cli/tests/link.test.ts` 的 `describe('esl unlink')` 追加（沿用文件内 `writeSkillSource` / `homeDir` / `projectDir`）：

```ts
  it('unlinks a global link by reading release.json from cwd when the name is omitted', async () => {
    const sourceDir = path.join(projectDir, 'markdown-master');
    writeSkillSource(sourceDir, '@forg/markdown-master', '# Live');
    await executeLink(sourceDir, { homeDir, global: true, noTools: true });

    const result = await executeUnlink(undefined, {
      homeDir,
      global: true,
      cwd: sourceDir,
      projectRoot: sourceDir
    });

    expect(result.identity).toBe('@forg/markdown-master');
    expect(result.restored).toBe(false);
    const manifest = await loadInstallManifest(path.join(homeDir, '.eslib'));
    expect(manifest.skills['@forg/markdown-master']).toBeUndefined();
  });

  it('unlinks a project link from the project root via an explicit skill path', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');
    await executeLink(sourceDir, { projectRoot: projectDir, homeDir, noTools: true });

    const result = await executeUnlink('./draft-skill', {
      projectRoot: projectDir,
      homeDir,
      cwd: projectDir
    });

    expect(result.identity).toBe('@local/draft-skill');
    expect(result.restored).toBe(false);
  });

  it('lists all linked identities when release.json identity mismatches the linked source path', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');
    await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true,
      identity: '@acme/draft-skill'
    });
    // 将 release.json name 改成与已 link 身份不同
    fs.writeFileSync(
      path.join(sourceDir, 'release.json'),
      JSON.stringify({
        schemaVersion: 3,
        name: '@other/draft-skill',
        version: '0.2.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );

    await expect(
      executeUnlink(undefined, {
        projectRoot: projectDir,
        homeDir,
        cwd: sourceDir
      })
    ).rejects.toThrow(/@acme\/draft-skill/i);
  });

  it('hints project-root path or --global when bare project unlink is run inside a skill directory', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, '@local/draft-skill', '# Draft');
    await executeLink(sourceDir, { projectRoot: projectDir, homeDir, noTools: true });

    await expect(
      executeUnlink(undefined, {
        projectRoot: sourceDir, // 模拟人在技能目录里：项目 Store 不在这里
        homeDir,
        cwd: sourceDir
      })
    ).rejects.toThrow(/project root|relative\/path|--global|@identity/i);
  });
```

实现时核对：`executeLink` 的 `--identity` 选项是否已支持 `@acme/draft-skill` 补全；若测试里 bare+identity 更稳，按 `link.ts` 现有 API 调整。全局 store 根目录写法对齐本文件已有 global 用例（若尚无，参考 `resolveLocalStorePaths({ homeDir }).root`）。

再补一条（可与上合并）：同一 `resolved` 对应两条 link 记录时，错误列出两个身份——可直接 `saveInstallManifest` 写入两条 `source: 'link'` 且 `resolved` 相同的手写条目后调用 `executeUnlink(undefined, { cwd: sourceDir, ... })`。

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run packages/cli/tests/link.test.ts -t "unlinks a global link by reading|unlinks a project link from the project root|lists all linked identities|hints project-root"`

Expected: FAIL（`executeUnlink` 仍要求已解析好的名字，或缺少新错误分支）。

- [ ] **Step 3: Write minimal implementation in `unlink.ts`**

要点（伪代码级，落到真实文件时保持现有 staging/恢复逻辑不动）：

```ts
export async function executeUnlink(target: string | undefined, options: UnlinkOptions = {}): Promise<UnlinkResult> {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = options.projectRoot ?? cwd;
  const resolved = await resolveUnlinkIdentity(target, { cwd });
  const name = resolved.identity;

  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;

  const installManifest = await loadInstallManifest(storeRoot);
  const entry = installManifest.skills[name];

  if (!entry || entry.source !== 'link') {
    if (resolved.fromDirectory && resolved.skillDir) {
      const matches = Object.entries(installManifest.skills)
        .filter(([, skill]) => skill.source === 'link' && skill.resolved && samePath(skill.resolved, resolved.skillDir))
        .map(([identity]) => identity)
        .filter((identity) => identity !== name);
      if (matches.length > 0) {
        throw new Error(
          `Skill directory ${resolved.skillDir} is linked as ${matches.join(', ')}, not ${name}; pass the linked @scope/skill-name explicitly`
        );
      }
    }

    let message = `Skill ${name} is not linked by ESL`;
    if (!options.global && resolved.usedOmitOrDot && resolved.skillDir) {
      const looksLikeSkillDir =
        (await fileExists(path.join(resolved.skillDir, 'release.json'))) ||
        (await fileExists(path.join(resolved.skillDir, 'SKILL.md')));
      if (looksLikeSkillDir) {
        message +=
          '. For a project-level Skill Source Link, run this from the project root as `esl unlink ./relative/path` or pass @identity; if the skill was linked with --global, pass --global';
      }
    }
    throw new Error(message);
  }

  // …其余保持现有 unlink 流程，最终 return { identity: name, ... }
}
```

保留所有既有 `executeUnlink('@…', …)` 测试：第一个参数仍可传字符串身份。

- [ ] **Step 4: Run unlink-related tests**

Run:

```bash
npx vitest run packages/cli/tests/link.test.ts
npx vitest run packages/cli/tests/resolve-unlink-identity.test.ts
```

Expected: PASS（含旧 unlink 用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/unlink.ts packages/cli/tests/link.test.ts
git commit -m "feat(cli): unlink 支持目录推导身份与不一致/脚枪错误"
```

---

### Task 3: Commander 接线与 help 文案

**Files:**
- Modify: `packages/cli/src/bin/esl.ts`（`unlink` 命令定义处，约现有 `.command('unlink')` 一段）

**Interfaces:**
- Consumes: `executeUnlink(target, options)`
- Produces: CLI `esl unlink [skill-name-or-path] [--global]`

- [ ] **Step 1: Write / adjust a thin bin-level assertion if the repo already patterns it**

若 `packages/cli/tests/bin.test.ts` 已有子命令 help 快照或 parse 测试，追加对 `unlink --help` 含 `[skill-name-or-path]` 的断言；若没有现成模式，本 Task 以手工 `esl unlink --help` 验证 + 依赖 Task 2 的 execute 覆盖，不强行新造 bin 测试框架。

最小可自动化示例（仅当 bin 测试基础设施顺手时）：

```ts
it('documents optional unlink skill-name-or-path', async () => {
  // 按 bin.test.ts 现有 createProgram / parseAsync --help 模式断言输出含
  // '[skill-name-or-path]' 与 'unlink --global' 类示例
});
```

- [ ] **Step 2: Run that test (if added) to see it fail — or skip to Step 3**

- [ ] **Step 3: Update `bin/esl.ts`**

将：

```ts
.argument('<skill-name>')
.option('--global', 'Unlink from global skills directory')
.addHelpText('after', example('$ esl unlink @local/my-skill'))
.action(async (skillName: string, options: { global?: boolean }) => {
  const result = await executeUnlink(skillName, options);
  ...
  console.log(`Skill ${skillName} unlinked...`);
});
```

改为：

```ts
.argument('[skill-name-or-path]', 'skill identity (@scope/name), or a skill directory (defaults to --cd or the current directory)')
.option('--global', 'Unlink from global skills directory')
.addHelpText(
  'after',
  example(
    '$ esl unlink @local/my-skill\n  $ esl unlink --global\n  $ esl unlink ./my-skill'
  )
)
.action(async (target: string | undefined, options: { global?: boolean }) => {
  const result = await executeUnlink(target, options);
  if (result.restored) {
    console.log(`Skill ${result.identity} unlinked; previous store copy restored at ${result.targetDir}`);
  } else {
    console.log(`Skill ${result.identity} unlinked`);
  }
});
```

help 示例顺序体现规格 Q8：显式身份 → global 目录内省略 → 项目根相对路径。可在 description 或 after 文本中加一句英文短注：project-level path form must be run from the project root；omit-in-directory is for `--global`。

- [ ] **Step 4: Verify help**

Run: `npx tsx packages/cli/src/bin/esl.ts unlink --help`  
（或仓库惯用的 `node packages/cli/dist/bin/esl.js unlink --help`，若需先 build 则先 `npm run build -w @esl/cli`）

Expected: 参数为可选 `[skill-name-or-path]`；示例含 `@…`、`--global`、`./…`。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/bin/esl.ts packages/cli/tests/bin.test.ts
git commit -m "feat(cli): unlink 可选参数与帮助示例"
```

---

### Task 4: 锁步更新 `esl-operator`

**Files:**
- Modify: `skills/esl-operator/references/consumer.md`（`esl unlink` 小节）
- 若 `skills/esl-operator/SKILL.md` 路由表有 unlink 措辞且会误导，一并核对（通常只需 consumer）

**Interfaces:**
- 无代码接口；文档必须与 Task 3 CLI 行为一致（AGENTS.md 客户端耦合约定）

- [ ] **Step 1: 将 consumer 中 unlink 段改成与规格一致**

把类似：

```md
`esl unlink @scope/skill-name [--global]`
```

替换为（简体中文，主推顺序正确）：

```md
`esl unlink [@scope/skill-name|./path] [--global]`

- 解除 Skill Source Link。有 staging 时纯本地恢复原副本和依赖/锁/安装状态；无 staging 时移除 link 和记录。
- staging 缺失或损坏时报错并保留 link 状态，不尝试联网恢复。
- **主推：** 显式 `@scope/skill-name`；已在技能目录且当初是 **global** link 时，可 `esl unlink --global`（省略身份，读当前目录 `release.json`）。
- **项目级：** 在**项目根**执行 `esl unlink ./相对路径`，或显式传身份。不承诺「cd 进技能子目录后做项目级裸 unlink」能找对 Store（CLI 不以技能目录向上查找 `.eslib`）。
- 非 `@` 参数一律视为路径。裸短名 `release.json.name` 按 `@local/<短名>` 推导。
- 若目录推出的身份与真实已 link 身份不一致，报错并列出真实身份；请改传显式 `@identity`。
- 进阶：`esl unlink -C <项目根> ./skills/foo`（`-C` 只改工作目录 / 项目根，位置路径决定读哪个技能目录）。
```

- [ ] **Step 2: 人工核对无残留「unlink 必须传 skill-name」的过时句子**

Run: 在 `skills/esl-operator` 内搜索 `unlink`。

Expected: 无与新行为矛盾的必填 `<skill-name>` 表述。

- [ ] **Step 3: Commit**

```bash
git add skills/esl-operator/references/consumer.md skills/esl-operator/SKILL.md
git commit -m "docs(esl-operator): 与 unlink 目录推导身份行为锁步"
```

---

### Task 5: 全量验证

**Files:**
- 无新文件；必要时仅修 Task 1–4 暴露的小问题

- [ ] **Step 1: Run unit/integration suites touched**

```bash
npx vitest run packages/cli/tests/resolve-unlink-identity.test.ts packages/cli/tests/link.test.ts
```

Expected: PASS。

- [ ] **Step 2: Run full verify required by repo**

```bash
npm test
npm run build
```

Expected: 全部通过。

- [ ] **Step 3: Manual smoke（可选但推荐）**

```bash
# 在一临时技能目录 global link 后：
esl unlink --global
# 在项目根：
esl unlink ./some-skill
```

Expected: 与规格 Acceptance Criteria 一致。

- [ ] **Step 4: Final commit only if Step 1–2 产生了修复 diff**

```bash
git add -A
git commit -m "test: 完成 unlink 目录推导身份的全量验证修复"
```

若无 diff 则跳过。

---

## Spec Coverage Self-Review

| 规格要求 | 任务 |
|---|---|
| 省略 / `.` / `./path` / `@identity` 解析 | Task 1 |
| 裸短名 → `@local/` | Task 1 |
| 非 `@` 一律路径 | Task 1 |
| `executeUnlink` 使用推导身份；projectRoot 不随路径移动 | Task 2 |
| 身份不一致列出全部匹配 | Task 2 |
| 项目级裸 unlink 脚枪提示 | Task 2 |
| `--global` 隔离 | Task 2 测试 |
| Commander 可选参数 + help 主推顺序 | Task 3 |
| esl-operator 锁步 | Task 4 |
| `npm test` / `npm run build` | Task 5 |
| 不做 uninstall / 不上找项目根 / 不改 link 路径参数 | Global Constraints + Out of Scope |

## Placeholder Scan

计划内无 TBD/TODO；测试与实现片段可直接落地。Task 2 中「global storeRoot 取法」全局 Store 根为 `path.join(homeDir, '.eslib')`（即 `resolveLocalStorePaths({ homeDir }).root`）。

