import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInstall } from '../src/commands/install.js';
import { executeUninstall } from '../src/commands/uninstall.js';
import { executeUpdate } from '../src/commands/update.js';
import { executeLink } from '../src/commands/link.js';
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

function infoEntry(name: string, visibility = 'public') {
  return { ok: true, json: async () => ({ name, visibility, versions: [] }) };
}

describe('esl dependency reclamation', () => {
  let projectDir: string;
  let homeDir: string;
  const server = 'http://localhost:3000';

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-reclaim-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-reclaim-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const options = (customFetch: unknown) => ({
    projectRoot: projectDir,
    homeDir,
    server,
    customFetch: customFetch as never,
    execFileAsync: vi.fn() as never,
    tools: ['claude'] as never
  });

  const lockVersion = async (identity: string) => (await loadSkillsLock(projectDir)).skills[identity]?.version;
  const storeExists = (identity: string) => {
    const [scope, name] = identity.split('/');
    return fs.existsSync(path.join(projectDir, '.eslib', 'skills', scope, name, 'SKILL.md'));
  };
  const linkExists = (identity: string) =>
    fs.existsSync(path.join(projectDir, '.claude', 'skills', identity.replace('@', '').replace('/', '_')));

  async function installRootA() {
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const rootA = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    const queue = [
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', versions: ['1.0.0'], packageUrl: `/api/packages/sk_a/1.0.0/${rootA.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => rootA.bytes },
      { ok: true, arrayBuffer: async () => shared.bytes },
      infoEntry('@platform-ai/shared')
    ];
    const fetch = vi.fn();
    for (const response of queue) fetch.mockResolvedValueOnce(response);
    await executeInstall('@platform-ai/root-a', options(fetch));
  }

  it('reclaims an orphaned transitive dependency when its only root is uninstalled', async () => {
    await installRootA();
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(linkExists('@platform-ai/shared')).toBe(true);

    await executeUninstall('@platform-ai/root-a', { projectRoot: projectDir, homeDir });

    expect((await loadSkillsJson(projectDir)).skills).toEqual({});
    expect(await lockVersion('@platform-ai/shared')).toBeUndefined();
    expect(storeExists('@platform-ai/shared')).toBe(false);
    expect(linkExists('@platform-ai/shared')).toBe(false);
  });

  it('keeps a shared dependency another remaining root still needs', async () => {
    await installRootA();

    // 装第二个根 root-c，同样依赖 shared（已装 1.2.0，相同版本直接复用）。
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const rootC = buildPackage({
      name: '@platform-ai/root-c',
      skillId: 'sk_c',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    const queue = [
      { ok: true, json: async () => ({ name: '@platform-ai/root-c', visibility: 'public', versions: ['1.0.0'], packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => rootC.bytes },
      { ok: true, arrayBuffer: async () => shared.bytes },
      infoEntry('@platform-ai/shared')
    ];
    const fetch = vi.fn();
    for (const response of queue) fetch.mockResolvedValueOnce(response);
    await executeInstall('@platform-ai/root-c', options(fetch));

    await executeUninstall('@platform-ai/root-a', { projectRoot: projectDir, homeDir });

    // shared 仍被 root-c 需要，保留；只有 root-a 被移除。
    expect(Object.keys((await loadSkillsJson(projectDir)).skills)).toEqual(['@platform-ai/root-c']);
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('fails to uninstall a transitive-only dependency a remaining root still needs', async () => {
    await installRootA();

    await expect(
      executeUninstall('@platform-ai/shared', { projectRoot: projectDir, homeDir })
    ).rejects.toThrow(/required by @platform-ai\/root-a/);

    // 失败不留痕：shared 仍在。
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
  });

  it('demotes a direct dependency that another root also needs as transitive', async () => {
    // 直接装 shared 作为根，再装 root-a（把 shared 当传递依赖）。
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const sharedQueue = [
      { ok: true, json: async () => ({ name: '@platform-ai/shared', visibility: 'public', versions: ['1.2.0'], packageUrl: `/api/packages/sk_shared/1.2.0/${shared.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => shared.bytes }
    ];
    const sharedFetch = vi.fn();
    for (const response of sharedQueue) sharedFetch.mockResolvedValueOnce(response);
    await executeInstall('@platform-ai/shared', options(sharedFetch));

    // root-a 依赖 shared，shared 已装 → 复用。
    const rootA = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    const aQueue = [
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', versions: ['1.0.0'], packageUrl: `/api/packages/sk_a/1.0.0/${rootA.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => rootA.bytes },
      { ok: true, arrayBuffer: async () => shared.bytes },
      infoEntry('@platform-ai/shared')
    ];
    const aFetch = vi.fn();
    for (const response of aQueue) aFetch.mockResolvedValueOnce(response);
    await executeInstall('@platform-ai/root-a', options(aFetch));

    const result = await executeUninstall('@platform-ai/shared', { projectRoot: projectDir, homeDir });

    expect(result.demotedToTransitive).toBe(true);
    expect(Object.keys((await loadSkillsJson(projectDir)).skills)).toEqual(['@platform-ai/root-a']);
    // 副本保留，仍可被 root-a 使用。
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('keeps a dependency a linked root still needs', async () => {
    // Registry 根 root-a 依赖 shared。
    await installRootA();

    // 再 link 一个本地根源，它同样依赖 shared——回收必须以 link 根的发布依赖图为准。
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const sourceDir = path.join(projectDir, 'linked-root');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '---\nname: linked-root\ndescription: x\n---\n');
    fs.writeFileSync(
      path.join(sourceDir, 'release.json'),
      JSON.stringify({
        schemaVersion: 4,
        name: '@platform-ai/linked-root',
        version: '0.1.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: { '@platform-ai/shared': '^1.0.0' }
      })
    );
    const baseInfo = {
      name: '@platform-ai/shared',
      visibility: 'public',
      versions: ['1.2.0'],
      releases: [{ version: '1.2.0', checksum: shared.checksum, skillId: 'sk_shared', releaseManifest: { dependencies: {} } }]
    };
    const linkFetch = vi.fn();
    for (const response of [
      { ok: true, json: async () => baseInfo },
      { ok: true, json: async () => baseInfo },
      { ok: true, arrayBuffer: async () => shared.bytes }
    ]) {
      linkFetch.mockResolvedValueOnce(response);
    }
    await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      server,
      customFetch: linkFetch as never,
      noTools: true
    });

    await executeUninstall('@platform-ai/root-a', { projectRoot: projectDir, homeDir });

    // linked-root 仍需要 shared：保留，不被误回收。
    expect(Object.keys((await loadSkillsJson(projectDir)).skills)).toEqual(['@platform-ai/linked-root']);
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('reclaims a transitive dependency the updated release no longer needs', async () => {
    await installRootA();

    // root-a 1.1.0 不再依赖 shared。
    const rootA11 = buildPackage({ name: '@platform-ai/root-a', skillId: 'sk_a', version: '1.1.0' });
    const queue = [
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', versions: ['1.1.0', '1.0.0'] }) },
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', versions: ['1.1.0', '1.0.0'], packageUrl: `/api/packages/sk_a/1.1.0/${rootA11.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => rootA11.bytes }
    ];
    const fetch = vi.fn();
    for (const response of queue) fetch.mockResolvedValueOnce(response);
    await executeUpdate({ projectRoot: projectDir, homeDir, server, customFetch: fetch as never });

    expect(await lockVersion('@platform-ai/root-a')).toBe('1.1.0');
    expect(await lockVersion('@platform-ai/shared')).toBeUndefined();
    expect(storeExists('@platform-ai/shared')).toBe(false);
  });
});
