import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInstall } from '../src/commands/install.js';
import { initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig, saveCredentials } from '@esl/core';

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

function ok(value: unknown) {
  return { ok: true, ...(value as object) };
}

function packageResponse(bytes: Buffer) {
  return { ok: true, arrayBuffer: async () => bytes };
}

function infoResponse(name: string, visibility: string) {
  return { ok: true, json: async () => ({ name, visibility, versions: [] }) };
}

describe('esl install multi-root merge', () => {
  let projectDir: string;
  let homeDir: string;
  const server = 'http://localhost:3000';

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-multroot-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-multroot-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: [] }, { homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function installOptions(customFetch: unknown) {
    return {
      projectRoot: projectDir,
      homeDir,
      server,
      customFetch: customFetch as never,
      execFileAsync: vi.fn() as never,
      noAdapt: true
    };
  }

  const sharedStoreJson = () =>
    JSON.parse(
      fs.readFileSync(
        path.join(projectDir, '.eslib', 'skills', '@platform-ai', 'shared', 'skill.json'),
        'utf8'
      )
    ) as { version: string };

  async function installRootA(customFetch: unknown) {
    // 根 A 依赖 shared，锁在 1.2.0；A 的清单范围是 ^1.0.0。
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const rootA = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-a',
            visibility: 'public',
            versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_a/1.0.0/${rootA.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootA.bytes))
      .mockResolvedValueOnce(packageResponse(shared.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'));
    await executeInstall('@platform-ai/root-a', installOptions(fetch));
  }

  it('elevates a shared dependency to the higher version the second root pins, when it still satisfies both ranges', async () => {
    await installRootA(vi.fn());

    const shared13 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.3.0' });
    const rootC = buildPackage({
      name: '@platform-ai/root-c',
      skillId: 'sk_c',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.2.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.3.0', checksum: shared13.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-c',
            visibility: 'public',
            versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootC.bytes))
      .mockResolvedValueOnce(packageResponse(shared13.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'));

    await executeInstall('@platform-ai/root-c', installOptions(fetch));

    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@platform-ai/shared'].version).toBe('1.3.0');
    expect(sharedStoreJson().version).toBe('1.3.0');
    // 两个根都在项目清单里，共享基础技能只保留一份更高副本。
    const skillsJson = await loadSkillsJson(projectDir);
    expect(Object.keys(skillsJson.skills).sort()).toEqual([
      '@platform-ai/root-a',
      '@platform-ai/root-c'
    ]);
    expect(lock.skills['@platform-ai/root-a'].version).toBe('1.0.0');
  });

  it('fails the whole install and leaves the existing graph untouched when the higher version breaks a range', async () => {
    // A 用 ~1.2.0 钉住 shared 1.2.0；C 引入 1.3.0，更高但不满足 A 的范围。
    const shared12 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const rootA = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '~1.2.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared12.checksum } }
    });
    await executeInstall(
      '@platform-ai/root-a',
      installOptions(
        vi
          .fn()
          .mockResolvedValueOnce(
            ok({
              json: async () => ({
                name: '@platform-ai/root-a',
                visibility: 'public',
                versions: ['1.0.0'],
                packageUrl: `/api/packages/sk_a/1.0.0/${rootA.checksum}.json`
              })
            })
          )
          .mockResolvedValueOnce(packageResponse(rootA.bytes))
          .mockResolvedValueOnce(packageResponse(shared12.bytes))
          .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'))
      )
    );

    const shared13 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.3.0' });
    const rootC = buildPackage({
      name: '@platform-ai/root-c',
      skillId: 'sk_c',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.3.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.3.0', checksum: shared13.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-c',
            visibility: 'public',
            versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootC.bytes))
      .mockResolvedValueOnce(packageResponse(shared13.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'));

    await expect(executeInstall('@platform-ai/root-c', installOptions(fetch))).rejects.toMatchObject({
      code: 'installedDependencyRangesConflict'
    });

    // 已有图保持原状：C 未进清单，shared 仍是 1.2.0。
    const skillsJson = await loadSkillsJson(projectDir);
    expect(Object.keys(skillsJson.skills)).toEqual(['@platform-ai/root-a']);
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@platform-ai/shared'].version).toBe('1.2.0');
    expect(sharedStoreJson().version).toBe('1.2.0');
  });

  it('fails a public root whose chain contains a private dependency', async () => {
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const root = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.2.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-a',
            visibility: 'public',
            versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_a/1.0.0/${root.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(root.bytes))
      .mockResolvedValueOnce(packageResponse(shared.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'private'));

    await expect(executeInstall('@platform-ai/root-a', installOptions(fetch))).rejects.toMatchObject({
      code: 'releaseDependencyPublicChainMustBePublic'
    });
    expect(fs.existsSync(path.join(projectDir, '.eslib', 'skills', '@platform-ai', 'shared'))).toBe(false);
  });
});
