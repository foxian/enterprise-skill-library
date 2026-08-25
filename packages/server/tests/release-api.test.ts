import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Skill Release API', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let gitea: {
    validateToken: ReturnType<typeof vi.fn>;
    createOrganizationRepo: ReturnType<typeof vi.fn>;
    createReleaseTag: ReturnType<typeof vi.fn>;
    getReleaseTag: ReturnType<typeof vi.fn>;
    readSourceTree?: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-release-'));
    gitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' }),
      createReleaseTag: vi.fn().mockResolvedValue(undefined),
      getReleaseTag: vi.fn().mockResolvedValue(null)
    };
    app = buildApp({
      dbPath: path.join(tmpDir, 'test.db'),
      packageRoot: path.join(tmpDir, 'packages'),
      giteaService: gitea as any,
      repoOwner: 'platform-ai'
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates an immutable release from a server-known source commit', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    });
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      version: '1.0.0',
      sourceCommit: 'abc123',
      skillId: expect.stringMatching(/^sk_/),
      status: 'published'
    });
    expect(fs.readdirSync(path.join(tmpDir, 'packages'))).toHaveLength(1);
  });

  it('uses release.json from the source commit instead of client metadata', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 1,
        license: 'Apache-2.0',
        keywords: ['server'],
        compatibility: {},
        dependencies: {}
      })
    });
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().releaseManifest).toMatchObject({
      license: 'Apache-2.0',
      keywords: ['server']
    });
  });

  it('rejects a duplicate release version without replacing the existing record', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });
    const payload = {
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      }
    };
    await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: { ...payload, sourceCommit: 'different' }
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toContain('already exists');
  });

  it('rejects publishing when the release tag already points to another commit', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });
    gitea.getReleaseTag.mockResolvedValueOnce({ name: 'v1.0.0', target: 'different' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('points to');
    expect(gitea.createReleaseTag).not.toHaveBeenCalled();
  });

  it('repairs a missing release tag without creating another release', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });
    const release = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });
    expect(release.statusCode).toBe(201);
    gitea.getReleaseTag.mockResolvedValueOnce(null);

    const repair = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/repair-tag',
      headers: { authorization: 'token alice-token' }
    });

    expect(repair.statusCode).toBe(200);
    expect(repair.json()).toMatchObject({
      repaired: true,
      tag: 'v1.0.0',
      sourceCommit: 'abc123'
    });
    expect(gitea.createReleaseTag).toHaveBeenLastCalledWith(
      'platform-ai',
      'reviewer',
      'v1.0.0',
      'abc123',
      'Release @platform-ai/reviewer 1.0.0'
    );
  });

  it('rejects release tag repair when the existing tag points elsewhere', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });
    await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });
    gitea.getReleaseTag.mockResolvedValueOnce({ name: 'v1.0.0', target: 'different' });

    const repair = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/repair-tag',
      headers: { authorization: 'token alice-token' }
    });

    expect(repair.statusCode).toBe(409);
    expect(repair.json().error).toContain('points to');
    expect(gitea.createReleaseTag).toHaveBeenCalledTimes(1);
  });
});
