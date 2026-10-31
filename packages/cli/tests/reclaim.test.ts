import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentInteractionRequiredError,
  findInstalledSkill,
  initializeLocalStore,
  loadInstallManifest,
  loadSkillsJson,
  loadSkillsLock,
  saveConfig,
  saveCredentials
} from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeUninstall } from '../src/commands/uninstall.js';
import { executeUpdate } from '../src/commands/update.js';
import { executeLink } from '../src/commands/link.js';
import { executeList } from '../src/commands/list.js';

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
  return { ok: true, json: async () => ({ name, visibility, instanceId: '11111111-1111-4111-8111-111111111111', versions: [] }) };
}

describe('esl dependency cleanup', () => {
  let projectDir: string;
  let homeDir: string;
  const server = 'http://localhost:4070';

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

  const lockVersion = async (identity: string) => {
    const lock = await loadSkillsLock(projectDir);
    return Object.entries(lock.skills).find(
      ([key, entry]) => entry.identity === identity || key === identity
    )?.[1].version;
  };
  const storeExists = (identity: string) => {
    const [scope, name] = identity.split('/');
    return fs.existsSync(
      path.join(projectDir, '.eslib', 'skills', '11111111-1111-4111-8111-111111111111', scope, name, 'SKILL.md')
    );
  };
  const linkExists = (identity: string) =>
    fs.existsSync(
      path.join(
        projectDir,
        '.claude',
        'skills',
        `${identity.replace('@', '').replace('/', '_')}_111111`
      )
    );
  const retainedFlag = async (identity: string) =>
    findInstalledSkill(
      await loadInstallManifest(path.join(projectDir, '.eslib')),
      identity
    )?.entry.retained;

  async function installQueued(responses: unknown[], name: string) {
    const fetch = vi.fn();
    for (const response of responses) fetch.mockResolvedValueOnce(response);
    return executeInstall(name, options(fetch));
  }

  async function installRootA() {
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const rootA = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    await installQueued(
      [
        { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'], packageUrl: `/api/packages/sk_a/1.0.0/${rootA.checksum}.json` }) },
        { ok: true, arrayBuffer: async () => rootA.bytes },
        { ok: true, arrayBuffer: async () => shared.bytes },
        infoEntry('@platform-ai/shared')
      ],
      '@platform-ai/root-a'
    );
  }

  it('keeps an orphaned transitive dependency by default when its only root is uninstalled', async () => {
    await installRootA();
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');

    const result = await executeUninstall('@platform-ai/root-a', { projectRoot: projectDir, homeDir });

    expect(result.reclaimed).toEqual([]);
    expect(result.cleanupCandidates?.map((candidate) => candidate.identity)).toEqual([
      '@platform-ai/shared'
    ]);
    expect((await loadSkillsJson(projectDir)).skills).toEqual({});
    // 默认全部不勾选：副本、锁、链接都保留；无人值守默认不冒充用户保留选择。
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(storeExists('@platform-ai/shared')).toBe(true);
    expect(linkExists('@platform-ai/shared')).toBe(true);
    expect(await retainedFlag('@platform-ai/shared')).toBeUndefined();
  });

  it('persists retention when the user explicitly submits an empty cleanup selection', async () => {
    await installRootA();

    await executeUninstall('@platform-ai/root-a', {
      projectRoot: projectDir,
      homeDir,
      interactive: true,
      selectCleanup: async () => []
    });

    expect(await retainedFlag('@platform-ai/shared')).toBe(true);
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('removes only the dependencies the user selected for cleanup, including select-all', async () => {
    await installRootA();

    const result = await executeUninstall('@platform-ai/root-a', {
      projectRoot: projectDir,
      homeDir,
      cleanup: ['@platform-ai/shared'],
      cleanupProvided: true
    });

    expect(result.reclaimed).toEqual(['@platform-ai/shared']);
    expect(await lockVersion('@platform-ai/shared')).toBeUndefined();
    expect(storeExists('@platform-ai/shared')).toBe(false);
    expect(linkExists('@platform-ai/shared')).toBe(false);

    // `all` 是清理多选的全选入口。
    await installRootA();
    const allResult = await executeUninstall('@platform-ai/root-a', {
      projectRoot: projectDir,
      homeDir,
      cleanup: ['all'],
      cleanupProvided: true
    });
    expect(allResult.reclaimed).toEqual(['@platform-ai/shared']);
    expect(storeExists('@platform-ai/shared')).toBe(false);
  });

  it('keeps a shared dependency another remaining root still needs without listing it as a candidate', async () => {
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
    await installQueued(
      [
        { ok: true, json: async () => ({ name: '@platform-ai/root-c', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'], packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json` }) },
        { ok: true, arrayBuffer: async () => rootC.bytes },
        { ok: true, arrayBuffer: async () => shared.bytes },
        infoEntry('@platform-ai/shared')
      ],
      '@platform-ai/root-c'
    );

    const result = await executeUninstall('@platform-ai/root-a', { projectRoot: projectDir, homeDir });

    expect(result.cleanupCandidates).toEqual([]);
    expect(Object.keys((await loadSkillsJson(projectDir)).skills)).toEqual(['@platform-ai/root-c']);
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('requires explicit impact acceptance to uninstall a dependency a remaining root still needs', async () => {
    await installRootA();

    await expect(
      executeUninstall('@platform-ai/shared', { projectRoot: projectDir, homeDir })
    ).rejects.toThrow(/required by @platform-ai\/root-a/);

    // 失败不留痕。
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('uninstalls an impact-accepted dependency, keeps the upstream skill, and shows the missing dependency', async () => {
    await installRootA();

    const result = await executeUninstall('@platform-ai/shared', {
      projectRoot: projectDir,
      homeDir,
      acceptDependencyImpact: ['@platform-ai/root-a']
    });

    expect(result.impactAffected).toEqual(['@platform-ai/root-a']);
    expect(await lockVersion('@platform-ai/shared')).toBeUndefined();
    expect(storeExists('@platform-ai/shared')).toBe(false);
    // 上游根保留，并呈现依赖缺失。
    expect(await lockVersion('@platform-ai/root-a')).toBe('1.0.0');
    const listed = await executeList({ projectRoot: projectDir, homeDir });
    expect(listed.find((entry) => entry.name === '@platform-ai/root-a')?.missingDependencies).toEqual([
      '@platform-ai/shared'
    ]);
  });

  it('emits an agent interaction request before deleting an impact target, then accepts the reported scope', async () => {
    await installRootA();

    const first = executeUninstall('@platform-ai/shared', {
      projectRoot: projectDir,
      homeDir,
      agentMode: true
    });
    await expect(first).rejects.toBeInstanceOf(AgentInteractionRequiredError);
    await first.catch((error: AgentInteractionRequiredError) => {
      expect(error.request.fields[0].id).toBe('acceptDependencyImpact');
      expect(error.request.fields[0].label).toContain('@platform-ai/root-a');
    });
    // 未确认前不删除。
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');

    const result = await executeUninstall('@platform-ai/shared', {
      projectRoot: projectDir,
      homeDir,
      agentMode: true,
      acceptDependencyImpact: ['@platform-ai/root-a']
    });
    expect(result.impactAffected).toEqual(['@platform-ai/root-a']);
    expect(storeExists('@platform-ai/shared')).toBe(false);
  });

  it('re-confirms when the impact grows beyond what the agent previously accepted', async () => {
    await installRootA();

    const first = executeUninstall('@platform-ai/shared', {
      projectRoot: projectDir,
      homeDir,
      agentMode: true
    });
    await expect(first).rejects.toBeInstanceOf(AgentInteractionRequiredError);

    // 只接受了一个不再完整的范围：仍要重新确认。
    const second = executeUninstall('@platform-ai/shared', {
      projectRoot: projectDir,
      homeDir,
      agentMode: true,
      acceptDependencyImpact: ['@platform-ai/some-other-skill']
    });
    await expect(second).rejects.toBeInstanceOf(AgentInteractionRequiredError);
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('keeps a dependency a linked root still needs', async () => {
    await installRootA();

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
      instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.2.0'],
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

    expect(Object.keys((await loadSkillsJson(projectDir)).skills)).toEqual(['@platform-ai/linked-root']);
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });

  it('defaults to keeping a dependency the updated release no longer needs, and only removes a selected one', async () => {
    await installRootA();

    const rootA11 = buildPackage({ name: '@platform-ai/root-a', skillId: 'sk_a', version: '1.1.0' });
    const updateQueue = [
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.1.0', '1.0.0'] }) },
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.1.0', '1.0.0'], packageUrl: `/api/packages/sk_a/1.1.0/${rootA11.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => rootA11.bytes }
    ];
    const fetch = vi.fn();
    for (const response of updateQueue) fetch.mockResolvedValueOnce(response);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await executeUpdate({ projectRoot: projectDir, homeDir, server, customFetch: fetch as never });

      expect(await lockVersion('@platform-ai/root-a')).toBe('1.1.0');
      // 默认不勾选：旧依赖保留，但无人值守不冒充用户保留选择。
      expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
      expect(storeExists('@platform-ai/shared')).toBe(true);
      expect(await retainedFlag('@platform-ai/shared')).toBeUndefined();

      // 用户明确提交「全部保留」后才持久化保留意图。
      const secondFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.1.0'] })
      });
      await executeUpdate({
        projectRoot: projectDir,
        homeDir,
        server,
        customFetch: secondFetch as never,
        agentMode: true,
        cleanup: [],
        cleanupProvided: true
      });
      expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');
      expect(await retainedFlag('@platform-ai/shared')).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('removes an old dependency selected through the agent cleanup answer', async () => {
    await installRootA();

    const rootA11 = buildPackage({ name: '@platform-ai/root-a', skillId: 'sk_a', version: '1.1.0' });
    const firstFetch = vi.fn();
    for (const response of [
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.1.0', '1.0.0'] }) },
      { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.1.0', '1.0.0'], packageUrl: `/api/packages/sk_a/1.1.0/${rootA11.checksum}.json` }) },
      { ok: true, arrayBuffer: async () => rootA11.bytes }
    ]) firstFetch.mockResolvedValueOnce(response);

    const first = executeUpdate({
      projectRoot: projectDir,
      homeDir,
      server,
      customFetch: firstFetch as never,
      agentMode: true
    });
    await expect(first).rejects.toBeInstanceOf(AgentInteractionRequiredError);
    await first.catch((error: AgentInteractionRequiredError) => {
      expect(error.request.fields[0].id).toBe('cleanup');
      expect(error.request.fields[0].default).toEqual([]);
    });
    // 问题发出前只完成更新，没有删除旧依赖。
    expect(await lockVersion('@platform-ai/shared')).toBe('1.2.0');

    const secondFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.1.0'] })
    });
    await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      server,
      customFetch: secondFetch as never,
      agentMode: true,
      cleanup: ['@platform-ai/shared'],
      cleanupProvided: true
    });

    expect(await lockVersion('@platform-ai/shared')).toBeUndefined();
    expect(storeExists('@platform-ai/shared')).toBe(false);
  });

  it('does not let a partial cleanup strand a retained candidate without its dependency', async () => {
    const child = buildPackage({ name: '@platform-ai/child', skillId: 'sk_child', version: '1.0.0' });
    const parent = buildPackage({
      name: '@platform-ai/parent',
      skillId: 'sk_parent',
      version: '1.0.0',
      dependencies: { '@platform-ai/child': '^1.0.0' },
      dependencyLock: { '@platform-ai/child': { skillId: 'sk_child', version: '1.0.0', checksum: child.checksum } }
    });
    const root = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/parent': '^1.0.0' },
      dependencyLock: { '@platform-ai/parent': { skillId: 'sk_parent', version: '1.0.0', checksum: parent.checksum } }
    });
    await installQueued(
      [
        { ok: true, json: async () => ({ name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'], packageUrl: `/api/packages/sk_a/1.0.0/${root.checksum}.json` }) },
        { ok: true, arrayBuffer: async () => root.bytes },
        { ok: true, arrayBuffer: async () => parent.bytes },
        { ok: true, arrayBuffer: async () => child.bytes },
        infoEntry('@platform-ai/parent'),
        infoEntry('@platform-ai/child')
      ],
      '@platform-ai/root-a'
    );

    // 只清理 child 会让保留的 parent 缺少依赖：拒绝扩大删除。
    await expect(
      executeUninstall('@platform-ai/root-a', {
        projectRoot: projectDir,
        homeDir,
        cleanup: ['@platform-ai/child'],
        cleanupProvided: true
      })
    ).rejects.toThrow(/@platform-ai\/parent/);
    expect(storeExists('@platform-ai/child')).toBe(true);

    // 同时选中 parent 与 child 才是一致的选择。
    const result = await executeUninstall('@platform-ai/root-a', {
      projectRoot: projectDir,
      homeDir,
      cleanup: ['@platform-ai/child', '@platform-ai/parent'],
      cleanupProvided: true
    });
    expect(result.reclaimed?.sort()).toEqual(['@platform-ai/child', '@platform-ai/parent']);
  });

  it('does not bypass impact confirmation when the dependent is a retained (non-candidate) copy', async () => {
    await installRootA();
    // 用户已保留 shared；它声明 extra，而 extra 是可清理候选。
    const { setInstalledSkillRetained, addLockEntry, recordInstalledSkill } = await import('@esl/core');
    const storeRoot = path.join(projectDir, '.eslib');
    await setInstalledSkillRetained(storeRoot, '@platform-ai/shared', '11111111-1111-4111-8111-111111111111', true);
    await addLockEntry(projectDir, '@platform-ai/extra', {
      skillId: 'sk_extra',
      version: '1.0.0',
      resolved: 'http://localhost:4070/api/packages/sk_extra/1.0.0/x.zip',
      integrity: '',
      instanceId: '11111111-1111-4111-8111-111111111111'
    });
    await recordInstalledSkill(
      storeRoot,
      '@platform-ai/extra',
      {
        skillId: 'sk_extra',
        version: '1.0.0',
        resolved: 'http://localhost:4070/api/packages/sk_extra/1.0.0/x.zip',
        integrity: '',
        instanceId: '11111111-1111-4111-8111-111111111111'
      },
      '^1.0.0'
    );
    const extraDir = path.join(storeRoot, 'skills', '11111111-1111-4111-8111-111111111111', '@platform-ai', 'extra');
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, 'SKILL.md'), '---\nname: extra\ndescription: x\n---\n');
    fs.writeFileSync(
      path.join(extraDir, 'skill.json'),
      JSON.stringify({ name: '@platform-ai/extra', version: '1.0.0', dependencies: {} })
    );
    const sharedDir = path.join(storeRoot, 'skills', '11111111-1111-4111-8111-111111111111', '@platform-ai', 'shared');
    const sharedJson = JSON.parse(fs.readFileSync(path.join(sharedDir, 'skill.json'), 'utf8'));
    sharedJson.dependencies = { '@platform-ai/extra': '^1.0.0' };
    fs.writeFileSync(path.join(sharedDir, 'skill.json'), JSON.stringify(sharedJson));

    await expect(
      executeUninstall('@platform-ai/root-a', {
        projectRoot: projectDir,
        homeDir,
        cleanup: ['@platform-ai/extra'],
        cleanupProvided: true
      })
    ).rejects.toThrow(/@platform-ai\/shared/);
    expect(storeExists('@platform-ai/extra')).toBe(true);
  });

  it('rejects a cleanup answer that names something outside the current candidate list', async () => {
    await installRootA();

    await expect(
      executeUninstall('@platform-ai/root-a', {
        projectRoot: projectDir,
        homeDir,
        cleanup: ['@platform-ai/unknown'],
        cleanupProvided: true
      })
    ).rejects.toThrow(/Invalid cleanup selection/);
    expect(storeExists('@platform-ai/root-a')).toBe(true);
    expect(storeExists('@platform-ai/shared')).toBe(true);
  });
});
