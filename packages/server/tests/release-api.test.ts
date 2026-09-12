import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

describe('Skill Release API', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let gitea: {
    validateToken: ReturnType<typeof vi.fn>;
    createOrganizationRepo: ReturnType<typeof vi.fn>;
    createReleaseTag: ReturnType<typeof vi.fn>;
    getReleaseTag: ReturnType<typeof vi.fn>;
    deleteReleaseTag: ReturnType<typeof vi.fn>;
    validateAdminUserToken: ReturnType<typeof vi.fn>;
    readSourceTree?: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-release-'));
    gitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'platform-ai_alice' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' }),
      createReleaseTag: vi.fn().mockResolvedValue(undefined),
      getReleaseTag: vi.fn().mockResolvedValue(null),
      deleteReleaseTag: vi.fn().mockResolvedValue(undefined),
      validateAdminUserToken: vi.fn().mockResolvedValue(null)
    };
    const db = initDatabase(path.join(tmpDir, 'test.db'));
    new TenantOrganizationRepository(db).create({ orgName: 'platform-ai', status: 'active' });
    db.close();
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
        schemaVersion: 2,
        version: '0.1.0',
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
          schemaVersion: 2,
          version: '0.1.0',
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

  async function upload(name: string) {
    return app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name, description: `${name} skill` }
    });
  }

  async function publish(target: string, version: string, dependencies: Record<string, string> = {}) {
    const manifest = {
      schemaVersion: 2,
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies
    };
    return app.inject({
      method: 'POST',
      url: `/api/skills/${target}/releases`,
      headers: { authorization: 'token alice-token' },
      payload: {
        version,
        sourceCommit: `commit-${version}`,
        releaseManifest: manifest,
        files: {
          'SKILL.md': '---\nname: reviewer\ndescription: Review code\n---\n',
          'release.json': JSON.stringify(manifest)
        }
      }
    });
  }

  it('serves the highest stable release as the default and lists versions newest first', async () => {
    await upload('reviewer');
    await publish('@platform-ai/reviewer', '1.2.0');
    await publish('@platform-ai/reviewer', '0.9.0');
    await publish('@platform-ai/reviewer', '2.0.0-beta.1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    // Newest first, prerelease included in the listing ...
    expect(response.json().versions).toEqual(['2.0.0-beta.1', '1.2.0', '0.9.0']);
    // ... but the default package stays on the highest stable release.
    expect(response.json().packageUrl).toContain('/1.2.0/');
  });

  it('freezes a dependency lock at the highest version that satisfies the range', async () => {
    await upload('dep');
    await publish('@platform-ai/dep', '1.2.0');
    await publish('@platform-ai/dep', '1.0.0');
    await upload('reviewer');

    const response = await publish('@platform-ai/reviewer', '1.0.0', { '@platform-ai/dep': '^1.0.0' });

    expect(response.statusCode).toBe(201);
    expect(response.json().dependencyLock['@platform-ai/dep'].version).toBe('1.2.0');
  });

  it('marks a release as deprecated with a message, and clears the mark', async () => {
    await upload('reviewer');
    await publish('@platform-ai/reviewer', '1.0.0');

    const mark = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/deprecate',
      headers: { authorization: 'token alice-token' },
      payload: { message: 'Use 1.1.0 instead; this release ships a broken regex' }
    });

    expect(mark.statusCode).toBe(200);
    expect(mark.json().deprecatedMessage).toBe('Use 1.1.0 instead; this release ships a broken regex');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(listed.json().releases[0].deprecatedMessage).toBe(
      'Use 1.1.0 instead; this release ships a broken regex'
    );

    const clear = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/deprecate',
      headers: { authorization: 'token alice-token' },
      payload: { message: '' }
    });

    expect(clear.statusCode).toBe(200);
    expect(clear.json().deprecatedMessage).toBeNull();
  });

  it('rejects deprecating a release of an archived skill', async () => {
    await upload('reviewer');
    await publish('@platform-ai/reviewer', '1.0.0');
    await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/archive',
      headers: { authorization: 'token alice-token' },
      payload: {}
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/deprecate',
      headers: { authorization: 'token alice-token' },
      payload: { message: 'too late' }
    });

    expect(response.statusCode).toBe(409);
  });

  it('deletes a single release and burns its version number', async () => {
    await upload('reviewer');
    await publish('@platform-ai/reviewer', '1.0.0');
    await publish('@platform-ai/reviewer', '0.9.0');

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/0.9.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '0.9.0' }
    });

    expect(response.statusCode).toBe(200);

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().versions).toEqual(['1.0.0']);
    expect(info.json().releases.map((release: { version: string }) => release.version)).toEqual(['1.0.0']);
    // The remaining release is untouched.
    expect(info.json().packageUrl).toContain('/1.0.0/');

    // The deleted version number stays burned.
    const republish = await publish('@platform-ai/reviewer', '0.9.0');
    expect(republish.statusCode).toBe(409);
  });

  it('requires the version as confirmation before deleting a release', async () => {
    await upload('reviewer');
    await publish('@platform-ai/reviewer', '1.0.0');

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: 'not-the-version' }
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses to delete a release another skill depends on unless a platform administrator forces it', async () => {
    await upload('dep');
    await publish('@platform-ai/dep', '1.0.0');
    await upload('reviewer');
    await publish('@platform-ai/reviewer', '1.0.0', { '@platform-ai/dep': '^1.0.0' });

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/dep/releases/1.0.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '1.0.0' }
    });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toContain('@platform-ai/reviewer');

    // A maintainer cannot force it ...
    const maintainerForce = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/dep/releases/1.0.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '1.0.0', force: true }
    });
    expect(maintainerForce.statusCode).toBe(403);

    // ... a platform administrator can.
    gitea.validateAdminUserToken = vi.fn().mockResolvedValue({ username: 'eslroot' });
    const adminForce = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/dep/releases/1.0.0/delete',
      headers: { authorization: 'token admin-token' },
      payload: { confirm: '1.0.0', force: true }
    });
    expect(adminForce.statusCode).toBe(200);
  });

  it('builds public package and clone URLs from forwarded proxy headers', async () => {
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
          schemaVersion: 2,
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        },
        files: {
          'SKILL.md': '---\nname: reviewer\n---\n',
          'release.json': JSON.stringify({
            schemaVersion: 2,
            version: '0.1.0',
            license: 'MIT',
            keywords: [],
            compatibility: {},
            dependencies: {}
          })
        }
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: {
        host: 'api:3000',
        'x-forwarded-host': 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: 'token alice-token'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git',
      packageUrl: expect.stringContaining('http://localhost:3000/api/packages/')
    });
  });

  it('uses release.json from the source commit instead of client metadata', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 2,
        version: '0.1.0',
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
          schemaVersion: 2,
          version: '0.1.0',
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

  it('keeps the release recoverable when the release tag push fails', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 2,
        version: '0.1.0',
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

    // Git Tag 推送失败:Release 已创建,不回滚,返回可恢复状态
    gitea.createReleaseTag.mockRejectedValueOnce(new Error('Failed to create Gitea release tag: boom'));
    const publish = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 2,
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });

    expect(publish.statusCode).toBe(201);
    expect(publish.json()).toMatchObject({ status: 'published', tagPending: true });

    // 用户经 repair-tag 补建 Release Tag,恢复一致
    const repair = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/repair-tag',
      headers: { authorization: 'token alice-token' }
    });
    expect(repair.statusCode).toBe(200);
    expect(repair.json()).toMatchObject({ repaired: true, tag: 'v1.0.0', sourceCommit: 'abc123' });

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().releases).toHaveLength(1);
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
        schemaVersion: 2,
        version: '0.1.0',
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
          schemaVersion: 2,
          version: '0.1.0',
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
          schemaVersion: 2,
          version: '0.1.0',
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
          schemaVersion: 2,
          version: '0.1.0',
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

  it('stores the release notes and uses them as the release tag message', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 2,
        version: '0.1.0',
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
          schemaVersion: 2,
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        },
        notes: '- fix: dead-link regex\n- feat: docx batch'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().notes).toBe('- fix: dead-link regex\n- feat: docx batch');
    expect(gitea.createReleaseTag).toHaveBeenCalledWith(
      'platform-ai',
      'reviewer',
      'v1.0.0',
      'abc123',
      '- fix: dead-link regex\n- feat: docx batch'
    );

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().releases[0].notes).toBe('- fix: dead-link regex\n- feat: docx batch');
  });

  it('lets a maintainer update the release notes after publishing', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 2,
        version: '0.1.0',
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
    await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 2,
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        },
        notes: 'original note'
      }
    });

    const update = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/notes',
      headers: { authorization: 'token alice-token' },
      payload: { message: 'revised note' }
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().notes).toBe('revised note');
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().releases[0].notes).toBe('revised note');
  });

  it('rejects updating release notes by a non-maintainer', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 2,
        version: '0.1.0',
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
    await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 2,
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });
    gitea.validateToken.mockResolvedValue({ username: 'bob' });

    const update = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases/1.0.0/notes',
      headers: { authorization: 'token bob-token' },
      payload: { message: 'revised' }
    });

    expect(update.statusCode).toBe(403);
  });
});
