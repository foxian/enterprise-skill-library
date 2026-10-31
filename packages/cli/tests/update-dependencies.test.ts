import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeLocalStore,
  loadInstallManifest,
  loadSkillsJson,
  loadSkillsLock,
  saveConfig,
  saveCredentials,
  setInstalledSkillRetained
} from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeUpdate } from '../src/commands/update.js';

interface PackageSpec {
  name: string;
  skillId: string;
  version: string;
  dependencies?: Record<string, string>;
  dependencyLock?: Record<string, { skillId: string; version: string; checksum: string }>;
}

function buildPackage(spec: PackageSpec): { bytes: Buffer; checksum: string } {
  const bytes = Buffer.from(
    JSON.stringify({
      name: spec.name,
      skillId: spec.skillId,
      version: spec.version,
      sourceCommit: `${spec.skillId}-${spec.version}`,
      releaseManifest: { compatibility: {}, dependencies: spec.dependencies ?? {} },
      dependencyLock: spec.dependencyLock ?? {},
      files: {
        'SKILL.md': `---\nname: ${spec.name.replace('@', '').replace('/', ':')}\ndescription: x\n---\n`,
        'skill.json': JSON.stringify({
          name: spec.name,
          version: spec.version,
          description: 'x',
          author: 'tester',
          dependencies: spec.dependencies ?? {}
        })
      }
    })
  );
  return { bytes, checksum: `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}` };
}

describe('esl update of an automatically installed dependency', () => {
  let projectDir: string;
  let homeDir: string;
  const server = 'http://localhost:4070';
  const instanceId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-update-dep-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-update-dep-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: [] }, { homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function options(customFetch: unknown) {
    return {
      projectRoot: projectDir,
      homeDir,
      server,
      customFetch: customFetch as never,
      execFileAsync: vi.fn() as never,
      noAdapt: true
    };
  }

  async function installRootWithShared(shared: ReturnType<typeof buildPackage>, range = '^1.0.0') {
    const root = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': range },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.0.0', checksum: shared.checksum } }
    });
    const fetch = vi.fn();
    for (const response of [
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId, versions: ['1.0.0'], packageUrl: `/api/packages/sk_a/1.0.0/${root.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => root.bytes },
      { ok: true, arrayBuffer: async () => shared.bytes },
      { ok: true, json: async () => ({ name: '@platform-ai/shared', visibility: 'public', instanceId, versions: ['1.0.0'] }) }
    ]) {
      fetch.mockResolvedValueOnce(response);
    }
    await executeInstall('@platform-ai/root-a', options(fetch));
  }

  const lockVersion = async (identity: string) => {
    const lock = await loadSkillsLock(projectDir);
    return lock.skills[`${identity}#${instanceId}`]?.version;
  };

  it('upgrades a transitive dependency without promoting it to a direct project dependency', async () => {
    const shared10 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.0.0' });
    await installRootWithShared(shared10);

    const shared11 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.1.0' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: '@platform-ai/shared', visibility: 'public', instanceId, versions: ['1.1.0', '1.0.0'] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/shared',
          visibility: 'public',
          instanceId,
          versions: ['1.1.0', '1.0.0'],
          packageUrl: `/api/packages/sk_shared/1.1.0/${shared11.checksum}.json`
        })
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => shared11.bytes });

    const result = await executeUpdate({
      ...options(fetch),
      skillName: '@platform-ai/shared'
    });

    expect(result).toEqual([{ name: '@platform-ai/shared', from: '1.0.0', to: '1.1.0' }]);
    expect(await lockVersion('@platform-ai/shared')).toBe('1.1.0');
    // 安装记录真实反映实际版本，但项目直接依赖清单不变。
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills[`@platform-ai/shared#${instanceId}`].version).toBe('1.1.0');
    expect(Object.keys((await loadSkillsJson(projectDir)).skills)).toEqual(['@platform-ai/root-a']);
  });

  it('warns about dependents whose declared range the new version leaves, then proceeds', async () => {
    const shared10 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.0.0' });
    await installRootWithShared(shared10, '^1.0.0');

    const shared20 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '2.0.0' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: '@platform-ai/shared', visibility: 'public', instanceId, versions: ['2.0.0', '1.0.0'] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/shared',
          visibility: 'public',
          instanceId,
          versions: ['2.0.0', '1.0.0'],
          packageUrl: `/api/packages/sk_shared/2.0.0/${shared20.checksum}.json`
        })
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => shared20.bytes });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await executeUpdate({ ...options(fetch), skillName: '@platform-ai/shared' });

    expect(result).toEqual([{ name: '@platform-ai/shared', from: '1.0.0', to: '2.0.0' }]);
    expect(await lockVersion('@platform-ai/shared')).toBe('2.0.0');
    const warning = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(warning).toContain('@platform-ai/shared@2.0.0');
    expect(warning).toContain('@platform-ai/root-a');
  });

  it('fills dependencies introduced by the updated transitive version', async () => {
    const shared10 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.0.0' });
    await installRootWithShared(shared10);

    const extra = buildPackage({ name: '@platform-ai/extra', skillId: 'sk_extra', version: '1.0.0' });
    const shared11 = buildPackage({
      name: '@platform-ai/shared',
      skillId: 'sk_shared',
      version: '1.1.0',
      dependencies: { '@platform-ai/extra': '^1.0.0' },
      dependencyLock: {
        '@platform-ai/extra': { skillId: 'sk_extra', version: '1.0.0', checksum: extra.checksum }
      }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: '@platform-ai/shared', visibility: 'public', instanceId, versions: ['1.1.0', '1.0.0'] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/shared',
          visibility: 'public',
          instanceId,
          versions: ['1.1.0', '1.0.0'],
          packageUrl: `/api/packages/sk_shared/1.1.0/${shared11.checksum}.json`
        })
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => shared11.bytes })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => extra.bytes })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: '@platform-ai/extra', visibility: 'public', instanceId, versions: ['1.0.0'] })
      });

    await executeUpdate({ ...options(fetch), skillName: '@platform-ai/shared' });

    expect(await lockVersion('@platform-ai/shared')).toBe('1.1.0');
    expect(await lockVersion('@platform-ai/extra')).toBe('1.0.0');
  });

  it('does not surface unrelated pre-existing orphans when nothing was updated', async () => {
    const shared10 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.0.0' });
    await installRootWithShared(shared10);
    // 让 shared 成为孤儿，但本次 update 不会改变任何版本。
    const rootJsonPath = path.join(
      projectDir,
      '.eslib',
      'skills',
      instanceId,
      '@platform-ai',
      'root-a',
      'skill.json'
    );
    const rootJson = JSON.parse(fs.readFileSync(rootJsonPath, 'utf8'));
    rootJson.dependencies = {};
    fs.writeFileSync(rootJsonPath, JSON.stringify(rootJson));

    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId, versions: ['1.0.0'] })
    });

    // Agent 模式下若无真正变化，不应抛出清理问题（退出码 2）。
    await expect(
      executeUpdate({
        ...options(fetch),
        agentMode: true
      })
    ).resolves.toEqual([]);
    expect(await lockVersion('@platform-ai/shared')).toBe('1.0.0');
  });

  it('preserves a retained flag when the retained dependency is updated independently', async () => {
    const shared10 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.0.0' });
    await installRootWithShared(shared10);
    await setInstalledSkillRetained(
      path.join(projectDir, '.eslib'),
      '@platform-ai/shared',
      instanceId,
      true
    );

    const shared11 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.1.0' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: '@platform-ai/shared', visibility: 'public', instanceId, versions: ['1.1.0', '1.0.0'] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/shared',
          visibility: 'public',
          instanceId,
          versions: ['1.1.0', '1.0.0'],
          packageUrl: `/api/packages/sk_shared/1.1.0/${shared11.checksum}.json`
        })
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => shared11.bytes });

    await executeUpdate({ ...options(fetch), skillName: '@platform-ai/shared' });

    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills[`@platform-ai/shared#${instanceId}`].version).toBe('1.1.0');
    expect(manifest.skills[`@platform-ai/shared#${instanceId}`].retained).toBe(true);
  });

  it('fails clearly when the requested skill is not installed', async () => {
    await expect(
      executeUpdate({ ...options(vi.fn()), skillName: '@platform-ai/not-installed' })
    ).rejects.toThrow(/not installed/);
  });
});
