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
  saveCredentials
} from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeList } from '../src/commands/list.js';
import { executeUninstall } from '../src/commands/uninstall.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';

function publishedPackage(name: string, version: string) {
  const bytes = Buffer.from(
    JSON.stringify({
      name,
      skillId: `sk_${version.replace(/\./g, '')}`,
      version,
      sourceCommit: `commit-${version}`,
      releaseManifest: { compatibility: {}, dependencies: {} },
      files: {
        'SKILL.md': `---\nname: acme:reviewer\ndescription: Reviews\n---\n`,
        'skill.json': JSON.stringify({ name, version, description: 'Reviews', author: 'tester' })
      }
    })
  );
  return { bytes, checksum: `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}` };
}

function infoFor(name: string, version: string, instanceId: string, checksum: string) {
  return {
    name,
    instanceId,
    versions: [version],
    visibility: 'public',
    packageUrl: `/api/packages/sk_${version.replace(/\./g, '')}/${version}/${checksum}.zip`
  };
}

describe('多实例同名技能隔离', () => {
  let homeDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-instances-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-instances-project-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function installFrom(server: string, instanceId: string, version: string) {
    const pkg = publishedPackage('@acme/reviewer', version);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => infoFor('@acme/reviewer', version, instanceId, pkg.checksum)
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => pkg.bytes });
    return executeInstall('@acme/reviewer', {
      homeDir,
      projectRoot,
      server,
      instanceId,
      tools: ['claude'],
      customFetch: fetchImpl as any,
      execFileAsync: vi.fn() as any
    });
  }

  it('installs the same identity from two instances into distinct store paths and tool links', async () => {
    await installFrom('http://a.example.com', INSTANCE_A, '1.0.0');
    await installFrom('http://b.example.com', INSTANCE_B, '2.0.0');

    const storeRoot = path.join(projectRoot, '.eslib');
    expect(
      fs.existsSync(path.join(storeRoot, 'skills', INSTANCE_A, '@acme', 'reviewer', 'SKILL.md'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(storeRoot, 'skills', INSTANCE_B, '@acme', 'reviewer', 'SKILL.md'))
    ).toBe(true);

    const manifest = await loadInstallManifest(storeRoot);
    expect(manifest.skills[`@acme/reviewer#${INSTANCE_A}`]).toMatchObject({
      identity: '@acme/reviewer',
      instanceId: INSTANCE_A,
      version: '1.0.0'
    });
    expect(manifest.skills[`@acme/reviewer#${INSTANCE_B}`]).toMatchObject({
      identity: '@acme/reviewer',
      instanceId: INSTANCE_B,
      version: '2.0.0'
    });

    expect(
      fs.lstatSync(path.join(projectRoot, '.claude', 'skills', 'acme_reviewer_111111')).isSymbolicLink()
    ).toBe(true);
    expect(
      fs.lstatSync(path.join(projectRoot, '.claude', 'skills', 'acme_reviewer_222222')).isSymbolicLink()
    ).toBe(true);
    // 链接、Store、清单、项目依赖与锁文件指向同一个实例，来源可辨识且一致。
    expect(
      path.resolve(
        fs.readlinkSync(path.join(projectRoot, '.claude', 'skills', 'acme_reviewer_111111'))
      )
    ).toBe(path.join(storeRoot, 'skills', INSTANCE_A, '@acme', 'reviewer'));
    expect(
      path.resolve(
        fs.readlinkSync(path.join(projectRoot, '.claude', 'skills', 'acme_reviewer_222222'))
      )
    ).toBe(path.join(storeRoot, 'skills', INSTANCE_B, '@acme', 'reviewer'));

    const skillsJson = await loadSkillsJson(projectRoot);
    expect(skillsJson.instances?.['@acme/reviewer']).toBe(INSTANCE_B);
    const lock = await loadSkillsLock(projectRoot);
    expect(lock.skills[`@acme/reviewer#${INSTANCE_A}`]?.instanceId).toBe(INSTANCE_A);
    expect(lock.skills[`@acme/reviewer#${INSTANCE_B}`]?.instanceId).toBe(INSTANCE_B);

    const listed = await executeList({ projectRoot, homeDir });
    expect(listed).toHaveLength(2);
    expect(listed.map((entry) => entry.instanceId).sort()).toEqual([INSTANCE_A, INSTANCE_B].sort());

    // 卸载指定实例只移除该实例的副本与链接，另一实例保持可用。
    await executeUninstall('@acme/reviewer', {
      projectRoot,
      homeDir,
      instanceId: INSTANCE_A
    });
    expect(
      fs.existsSync(path.join(storeRoot, 'skills', INSTANCE_A, '@acme', 'reviewer'))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(storeRoot, 'skills', INSTANCE_B, '@acme', 'reviewer'))
    ).toBe(true);
  });

  it('fails remote installs when the server does not advertise an Instance ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/reviewer', versions: ['1.0.0'] })
    });
    await expect(
      executeInstall('@acme/reviewer', {
        homeDir,
        projectRoot,
        server: 'http://legacy.example.com',
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow(/did not return an Instance ID/);
  });

  it('fails remote installs when a registered address silently changes instance identity', async () => {
    await saveConfig(
      {
        server: 'http://a.example.com',
        selectedInstanceId: INSTANCE_A,
        servers: [
          {
            instanceId: INSTANCE_A,
            preferredAddress: 'http://a.example.com',
            addresses: [{ url: 'http://a.example.com', confirmedAt: new Date().toISOString() }]
          }
        ]
      },
      { homeDir }
    );
    const pkg = publishedPackage('@acme/reviewer', '1.0.0');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => infoFor('@acme/reviewer', '1.0.0', INSTANCE_B, pkg.checksum)
    });

    await expect(
      executeInstall('@acme/reviewer', {
        homeDir,
        projectRoot,
        server: 'http://a.example.com',
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow(/silently rebound source/);
  });

  it('reproduces a locked dependency from the instance address after a migration', async () => {
    await installFrom('http://old.example.com', INSTANCE_A, '1.0.0');

    // 同一实例迁移到新地址并登记首选地址；依赖锁仍只记 Instance ID。
    await saveConfig(
      {
        server: 'http://new.example.com',
        selectedInstanceId: INSTANCE_A,
        servers: [
          {
            instanceId: INSTANCE_A,
            preferredAddress: 'http://new.example.com',
            addresses: [
              { url: 'http://new.example.com', confirmedAt: new Date().toISOString() }
            ]
          }
        ]
      },
      { homeDir }
    );

    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/public/server-identity')) {
        return {
          ok: true,
          json: async () => ({ instanceId: INSTANCE_A, protocolVersion: 1 })
        };
      }
      const pkg = publishedPackage('@acme/reviewer', '1.0.0');
      if (url.includes('/api/packages/')) {
        return { ok: true, arrayBuffer: async () => pkg.bytes };
      }
      return {
        ok: true,
        json: async () => infoFor('@acme/reviewer', '1.0.0', INSTANCE_A, pkg.checksum)
      };
    });

    await executeInstall('@acme/reviewer', {
      homeDir,
      projectRoot,
      instanceId: INSTANCE_A,
      customFetch: fetchImpl as any,
      execFileAsync: vi.fn() as any
    });

    const lock = await loadSkillsLock(projectRoot);
    expect(lock.skills[`@acme/reviewer#${INSTANCE_A}`]?.instanceId).toBe(INSTANCE_A);
    expect(
      fs.existsSync(path.join(projectRoot, '.eslib', 'skills', INSTANCE_A, '@acme', 'reviewer'))
    ).toBe(true);
  });

});
