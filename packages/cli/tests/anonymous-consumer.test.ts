import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore } from '@esl/core';
import { executeSearch } from '../src/commands/search.js';
import { executeInstall } from '../src/commands/install.js';

// 匿名消费链路（ADR-0073）：没有登录态时 search/info/install 不带凭据，
// 只对 anonymous 已发布技能成功；public/private 的筛选明确要求登录。
describe('anonymous CLI consumption', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-anonymous-cli-'));
    await initializeLocalStore({ homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('searches without credentials and lets the server decide what is visible', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          name: '@alice/open',
          description: 'Anonymous skill',
          latestStableVersion: '1.0.0',
          visibility: 'anonymous',
          downloadCount: 3
        }
      ]
    });

    const results = await executeSearch('', {
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });

    expect(results).toEqual([expect.objectContaining({ name: '@alice/open', visibility: 'anonymous' })]);
    const [, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.authorization).toBeUndefined();
  });

  it('refuses public and private filters without login instead of returning a false empty result', async () => {
    for (const visibility of ['public', 'private'] as const) {
      await expect(
        executeSearch('', {
          homeDir,
          server: 'http://localhost:3000',
          customFetch: vi.fn() as any,
          visibility
        })
      ).rejects.toThrow(/requires login/);
    }
  });

  it('installs an anonymous Published Skill Package without credentials', async () => {
    const packageBytes = Buffer.from(JSON.stringify({
      name: '@alice/open',
      skillId: 'sk_01J00000000000000000000000',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 3,
        version: '0.1.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      },
      files: {
        'SKILL.md': '---\nname: alice:open\ndescription: Anonymous skill\n---\n\n# Open\n',
        'skill.json': '{\n  "name": "@alice/open",\n  "version": "1.0.0"\n}\n'
      }
    }));
    const checksum = `sha256-${crypto.createHash('sha256').update(packageBytes).digest('hex')}`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@alice/open',
          skillId: 'sk_01J00000000000000000000000',
          instanceId: '11111111-1111-4111-8111-111111111111',
          versions: ['1.0.0'],
          visibility: 'anonymous',
          packageUrl: `/api/packages/sk_01J00000000000000000000000/1.0.0/${checksum}.json`
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => packageBytes
      });

    const target = await executeInstall('@alice/open', {
      homeDir,
      global: true,
      noAdapt: true,
      server: 'http://localhost:4070',
      customFetch: fetchImpl as any,
      execFileAsync: vi.fn() as any
    });

    expect(fs.existsSync(path.join(target, 'skill.json'))).toBe(true);
    for (const [, init] of fetchImpl.mock.calls as Array<[string, { headers: Record<string, string> }]>) {
      expect(init.headers.authorization).toBeUndefined();
    }
  });

  it('fails without writing a half-installed root when an anonymous dependency is inaccessible', async () => {
    const projectRoot = path.join(homeDir, 'project');
    fs.mkdirSync(projectRoot);
    const dependencyChecksum = `sha256-${'0'.repeat(64)}`;
    const rootBytes = Buffer.from(JSON.stringify({
      name: '@alice/open',
      skillId: 'sk_01J00000000000000000000000',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 3,
        version: '0.1.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: { '@alice/closed': '*' }
      },
      dependencyLock: {
        '@alice/closed': {
          skillId: 'sk_01J00000000000000000000001',
          version: '1.0.0',
          checksum: dependencyChecksum
        }
      },
      files: {
        'SKILL.md': '---\nname: alice:open\ndescription: Anonymous skill\n---\n\n# Open\n',
        'skill.json': '{\n  "name": "@alice/open",\n  "version": "1.0.0"\n}\n'
      }
    }));
    const rootChecksum = `sha256-${crypto.createHash('sha256').update(rootBytes).digest('hex')}`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@alice/open',
          skillId: 'sk_01J00000000000000000000000',
          instanceId: '11111111-1111-4111-8111-111111111111',
          versions: ['1.0.0'],
          visibility: 'anonymous',
          packageUrl: `/api/packages/sk_01J00000000000000000000000/1.0.0/${rootChecksum}.json`
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => rootBytes
      })
      // 依赖不是 anonymous：匿名安装必须失败，且不能留下半套根技能。
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"Unauthorized: missing token"}'
      });

    await expect(
      executeInstall('@alice/open', {
        projectRoot,
        homeDir,
        noAdapt: true,
        server: 'http://localhost:4070',
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow(/Failed to download Published Skill Package/);

    expect(
      fs.existsSync(
        path.join(projectRoot, '.eslib', 'skills', '11111111-1111-4111-8111-111111111111', '@alice', 'open')
      )
    ).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, '.skills.json'))).toBe(false);
  });
});
