import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinPackage, loadSkillsLock, loadSkillsJson, loadBuiltinPackageOrThrow } from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeUpdate } from '../src/commands/update.js';
import { executeUninstall } from '../src/commands/uninstall.js';
import { executeUse } from '../src/commands/use.js';
import { executeInfo } from '../src/commands/info.js';
import { syncGlobalBuiltinSkill } from '../src/commands/sync-builtin.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const identity = '@builtin/skill-forge';
describe('独立版本的内置 skill-forge', () => {
  let root: string;
  let sourceDir: string;
  let builtinDir: string;
  let projectRoot: string;
  let homeDir: string;
  const build = (version = '1.0.0') => {
    return fs.writeFile(path.join(sourceDir, 'skill.json'), JSON.stringify({
      name: identity, version, description: '创建与评测技能', author: 'foxian'
    })).then(() => buildBuiltinPackage({ sourceDir, outputRoot: builtinDir, identity,
      cliVersion: '9.8.7-beta.1', versionSource: 'skill' }));
  };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-forge-'));
    sourceDir = path.join(root, 'source');
    builtinDir = path.join(root, 'builtin');
    projectRoot = path.join(root, 'project');
    homeDir = path.join(root, 'home');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.cp(path.join(repoRoot, 'skills/skill-forge'), sourceDir, { recursive: true });
  });
  afterEach(async () => {
    if (!root) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rm(root, { recursive: true, force: true });
        return;
      } catch (error) {
        if (!['ENOTEMPTY', 'EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  });


  it('打包实际资源并排除嵌套缓存与产物，独立于 CLI 版本', async () => {
    await fs.mkdir(path.join(sourceDir, 'scripts/__pycache__'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'scripts/__pycache__/test.pyc'), 'cache');
    await fs.writeFile(path.join(sourceDir, 'sample.skill'), 'sample');
    await fs.writeFile(path.join(sourceDir, 'scripts/test.pyc'), 'cache');
    await build();
    const pkg = await loadBuiltinPackageOrThrow(builtinDir, identity);
    expect(pkg.version).toBe('1.0.0');
    for (const file of ['SKILL.md', 'skill.json', 'LICENSE.txt', 'scripts/quick_validate.py',
      'eval-viewer/viewer.html', 'agents/grader.md', 'references/authoring.md', 'assets/eval_review.html']) {
      await expect(fs.access(path.join(pkg.directory, file))).resolves.toBeUndefined();
    }
    for (const file of ['sample.skill', 'scripts/__pycache__', 'scripts/test.pyc']) {
      await expect(fs.access(path.join(pkg.directory, file))).rejects.toThrow();
    }
  });

  // timeout 必须作为 it.each 返回函数的第三个参数传入；放在 cases 的第二个参数
  // 会被当成额外表项，实际超时仍是默认 5s。
  it.each([false, true])('无需网络安装、查看、更新和卸载（global=%s）', async global => {
    await build();
    const customFetch = vi.fn(() => { throw new Error('不应联网'); });
    const options = { projectRoot, homeDir, builtinDir, global, customFetch, noAdapt: true };
    const directory = await executeInstall(identity, options);
    const dependencyRoot = global ? path.join(homeDir, '.eslib') : projectRoot;
    expect((await loadSkillsJson(dependencyRoot)).skills[identity]).toBe('builtin:skill-forge');
    expect((await loadSkillsLock(dependencyRoot)).skills[identity]).toMatchObject({ version: '1.0.0', source: 'builtin' });
    expect((await executeInfo(identity, options)).versions).toEqual(['1.0.0']);
    expect(await executeUse(identity, options)).toContain('技能锻造坊');
    await build('1.1.0');
    expect(await executeUpdate({ ...options, skillName: identity })).toEqual([{ name: identity, from: '1.0.0', to: '1.1.0' }]);
    await executeUninstall(identity, options);
    expect((await loadSkillsLock(dependencyRoot)).skills[identity]).toBeUndefined();
    await expect(fs.access(directory)).rejects.toThrow();
    expect(customFetch).not.toHaveBeenCalled();
  }, 30000);

  it('拒绝降级并保持原安装内容和锁文件', async () => {
    await build('1.2.0');
    const options = { projectRoot, homeDir, builtinDir, noAdapt: true };
    const dir = await executeInstall(identity, options);
    const before = await fs.readFile(path.join(dir, 'skill.json'), 'utf8');
    await build('1.1.0');
    await expect(executeUpdate({ ...options, skillName: identity })).rejects.toThrow('Cannot downgrade');
    expect(await fs.readFile(path.join(dir, 'skill.json'), 'utf8')).toBe(before);
    expect((await loadSkillsLock(projectRoot)).skills[identity]?.version).toBe('1.2.0');
  });

  it('全局副本不参与 CLI lifecycle 自动同步', async () => {
    await build();
    await executeInstall(identity, { homeDir, builtinDir, global: true, noAdapt: true });
    await build('1.1.0');
    expect(await syncGlobalBuiltinSkill({ homeDir, builtinDir })).toEqual({ synced: false, failed: false });
    expect((await loadSkillsLock(path.join(homeDir, '.eslib'))).skills[identity]?.version).toBe('1.0.0');
  });

  it('源码身份或版本不合法时拒绝构建', async () => {
    await build();
    await fs.writeFile(path.join(sourceDir, 'skill.json'), JSON.stringify({ name: '@builtin/wrong', version: '1.0.0', description: 'test', author: 'foxian' }));
    const options = { sourceDir, outputRoot: builtinDir, identity, cliVersion: '0.1.1', versionSource: 'skill' as const };
    await expect(buildBuiltinPackage(options)).rejects.toThrow('name must match');
    await fs.writeFile(path.join(sourceDir, 'skill.json'), JSON.stringify({ name: identity, version: 'bad', description: 'test', author: 'foxian' }));
    await expect(buildBuiltinPackage(options)).rejects.toThrow('Invalid built-in skill.json');
  });
});
