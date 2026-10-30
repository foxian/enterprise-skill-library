import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addServerAddress,
  createEmptyServerRegistry,
  discoverServerIdentity,
  findServerInstanceByAddress,
  normalizeServerUrl,
  removeServerAddress,
  selectServerInstance
} from '../src/server/instance-identity.js';
import { createToolLink, loadToolLinkManifest } from '../src/link/tool-links.js';
import { recordInstalledSkill } from '../src/store/skills-json.js';
import { skillSourceRelativeDir } from '../src/store/skill-store.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';

describe('server instance identity registry', () => {
  it('normalizes addresses and keeps the first instance selected', () => {
    expect(normalizeServerUrl(' http://localhost:4070/ ')).toBe('http://localhost:4070');
    const result = addServerAddress(createEmptyServerRegistry(), {
      instanceId: INSTANCE_A,
      url: 'http://localhost:4070/',
      select: true
    });
    expect(result.createdInstance).toBe(true);
    expect(result.instance.preferredAddress).toBe('http://localhost:4070');
    expect(result.registry.selectedInstanceId).toBe(INSTANCE_A);
  });

  it('keeps multiple addresses per instance and selects fallbacks deterministically', () => {
    let registry = addServerAddress(createEmptyServerRegistry(), {
      instanceId: INSTANCE_A,
      url: 'http://a.example.com',
      select: true
    }).registry;
    registry = addServerAddress(registry, {
      instanceId: INSTANCE_A,
      url: 'http://b.example.com'
    }).registry;
    expect(registry.instances[0].addresses.map((address) => address.url)).toEqual([
      'http://a.example.com',
      'http://b.example.com'
    ]);
    expect(registry.instances[0].preferredAddress).toBe('http://a.example.com');
    expect(findServerInstanceByAddress(registry, 'http://b.example.com')?.instance.instanceId).toBe(
      INSTANCE_A
    );
  });

  it('refuses to rebind an existing address to a different instance', () => {
    const registry = addServerAddress(createEmptyServerRegistry(), {
      instanceId: INSTANCE_A,
      url: 'http://a.example.com'
    }).registry;
    expect(() =>
      addServerAddress(registry, { instanceId: INSTANCE_B, url: 'http://a.example.com' })
    ).toThrow(/Refusing to rebind silently/);
  });

  it('removes only the requested address and rewrites the preferred address', () => {
    let registry = addServerAddress(createEmptyServerRegistry(), {
      instanceId: INSTANCE_A,
      url: 'http://a.example.com',
      select: true
    }).registry;
    registry = addServerAddress(registry, { instanceId: INSTANCE_A, url: 'http://b.example.com' }).registry;
    const result = removeServerAddress(registry, 'http://a.example.com');
    expect(result.removed).toBe(true);
    expect(result.registry.instances[0].preferredAddress).toBe('http://b.example.com');
    expect(selectServerInstance(result.registry, INSTANCE_A).selectedInstanceId).toBe(INSTANCE_A);
  });

  it('discovers the instance ID anonymously and rejects malformed responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ instanceId: INSTANCE_A, protocolVersion: 1 })
    });
    await expect(
      discoverServerIdentity('http://localhost:4070', { fetchImpl: fetchImpl as any })
    ).resolves.toEqual({ instanceId: INSTANCE_A, protocolVersion: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:4070/api/public/server-identity',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );

    const invalid = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ instanceId: 'nope' }) });
    await expect(
      discoverServerIdentity('http://localhost:4070', { fetchImpl: invalid as any })
    ).rejects.toThrow(/did not return a valid Instance ID/);
  });
});

describe('instance-isolated tool links', () => {
  let homeDir: string;
  let projectRoot: string;
  let storeRoot: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-instance-home-'));
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-instance-project-'));
    storeRoot = path.join(projectRoot, '.eslib');
    for (const instanceId of [INSTANCE_A, INSTANCE_B]) {
      await fs.mkdir(path.join(storeRoot, skillSourceRelativeDir('@acme/reviewer', instanceId)), {
        recursive: true
      });
    }
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps the same identity from two instances in distinct store paths and links', async () => {
    await recordInstalledSkill(storeRoot, '@acme/reviewer', {
      instanceId: INSTANCE_A,
      version: '1.0.0',
      resolved: 'https://a.example.com/pkg',
      integrity: 'sha256-a',
      source: 'registry'
    });
    await recordInstalledSkill(storeRoot, '@acme/reviewer', {
      instanceId: INSTANCE_B,
      version: '2.0.0',
      resolved: 'https://b.example.com/pkg',
      integrity: 'sha256-b',
      source: 'registry'
    });

    const first = await createToolLink({
      identity: '@acme/reviewer',
      instanceId: INSTANCE_A,
      tool: 'claude',
      level: 'project',
      storeRoot,
      projectRoot,
      homeDir
    });
    const second = await createToolLink({
      identity: '@acme/reviewer',
      instanceId: INSTANCE_B,
      tool: 'claude',
      level: 'project',
      storeRoot,
      projectRoot,
      homeDir
    });

    expect(first.targetDir).not.toBe(second.targetDir);
    expect(path.basename(first.targetDir)).toBe('acme_reviewer_111111');
    expect(path.basename(second.targetDir)).toBe('acme_reviewer_222222');
    const manifest = await loadToolLinkManifest(storeRoot);
    expect(manifest.links).toHaveLength(2);
    expect(manifest.links.map((link) => link.instanceId).sort()).toEqual([INSTANCE_A, INSTANCE_B].sort());
  });

  it('grows the instance prefix when a colliding directory already exists', async () => {
    // 构造与默认 6 位前缀冲突的目录：另一实例恰好共享同一前缀。
    const collidingInstance = '111111aa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await fs.mkdir(path.join(storeRoot, skillSourceRelativeDir('@acme/reviewer', collidingInstance)), {
      recursive: true
    });
    await fs.mkdir(path.join(projectRoot, '.claude', 'skills', 'acme_reviewer_111111'), {
      recursive: true
    });

    const link = await createToolLink({
      identity: '@acme/reviewer',
      instanceId: INSTANCE_A,
      tool: 'claude',
      level: 'project',
      storeRoot,
      projectRoot,
      homeDir
    });

    // 默认 6 位被占用后加长到 8 位，绝不覆盖已有目录。
    expect(path.basename(link.targetDir)).toBe('acme_reviewer_11111111');
    expect((await fs.stat(path.join(projectRoot, '.claude', 'skills', 'acme_reviewer_111111'))).isDirectory()).toBe(
      true
    );
  });
});
