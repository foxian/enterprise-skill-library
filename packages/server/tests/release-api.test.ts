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
    createRepo: ReturnType<typeof vi.fn>;
    createReleaseTag: ReturnType<typeof vi.fn>;
    getReleaseTag: ReturnType<typeof vi.fn>;
    deleteReleaseTag: ReturnType<typeof vi.fn>;
    validateAdminUserToken: ReturnType<typeof vi.fn>;
    readSourceTree?: ReturnType<typeof vi.fn>;
    listRepoTeams: ReturnType<typeof vi.fn>;
    isTeamMember: ReturnType<typeof vi.fn>;
    isCollaborator: ReturnType<typeof vi.fn>;
    getCollaboratorPermission: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-release-'));
    gitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      createRepo: vi.fn().mockResolvedValue({ full_name: 'alice/reviewer' }),
      createReleaseTag: vi.fn().mockResolvedValue(undefined),
      getReleaseTag: vi.fn().mockResolvedValue(null),
      deleteReleaseTag: vi.fn().mockResolvedValue(undefined),
      validateAdminUserToken: vi.fn().mockResolvedValue(null),
      // 默认无任何团队/协作者授权：Public 技能仍可读，Private 技能对外不可读。
      listRepoTeams: vi.fn().mockResolvedValue([]),
      isTeamMember: vi.fn().mockResolvedValue(false),
      isCollaborator: vi.fn().mockResolvedValue(false),
      getCollaboratorPermission: vi.fn().mockResolvedValue(null)
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
        schemaVersion: 3,
        name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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

  const SKILL_FILES = {
    'SKILL.md': '---\nname: reviewer\ndescription: Review code\n---\n'
  };

  async function publish(target: string, version: string, dependencies: Record<string, string> = {}) {
    const manifest = {
      schemaVersion: 3,
      name: target,
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
          ...SKILL_FILES,
          'release.json': JSON.stringify(manifest)
        }
      }
    });
  }

  async function setVisibility(target: string, visibility: 'public' | 'private') {
    return app.inject({
      method: 'POST',
      url: `/api/skills/${target}/visibility`,
      headers: { authorization: 'token alice-token' },
      payload: { visibility }
    });
  }

  async function dryRunPublish(target: string, dependencies: Record<string, string>) {
    const manifest = {
      schemaVersion: 3,
      name: target,
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
        version: '1.0.0',
        sourceCommit: 'unpushed-commit',
        releaseManifest: manifest,
        files: {
          ...SKILL_FILES,
          'release.json': JSON.stringify(manifest)
        },
        dryRun: true
      }
    });
  }

  it('serves the highest stable release as the default and lists versions newest first', async () => {
    await upload('reviewer');
    await publish('@alice/reviewer', '1.2.0');
    await publish('@alice/reviewer', '0.9.0');
    await publish('@alice/reviewer', '2.0.0-beta.1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
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
    await publish('@alice/dep', '1.2.0');
    await publish('@alice/dep', '1.0.0');
    await upload('reviewer');

    const response = await publish('@alice/reviewer', '1.0.0', { '@alice/dep': '^1.0.0' });

    expect(response.statusCode).toBe(201);
    expect(response.json().dependencyLock['@alice/dep'].version).toBe('1.2.0');
  });

  it('marks a release as deprecated with a message, and clears the mark', async () => {
    await upload('reviewer');
    await publish('@alice/reviewer', '1.0.0');

    const mark = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases/1.0.0/deprecate',
      headers: { authorization: 'token alice-token' },
      payload: { message: 'Use 1.1.0 instead; this release ships a broken regex' }
    });

    expect(mark.statusCode).toBe(200);
    expect(mark.json().deprecatedMessage).toBe('Use 1.1.0 instead; this release ships a broken regex');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(listed.json().releases[0].deprecatedMessage).toBe(
      'Use 1.1.0 instead; this release ships a broken regex'
    );

    const clear = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases/1.0.0/deprecate',
      headers: { authorization: 'token alice-token' },
      payload: { message: '' }
    });

    expect(clear.statusCode).toBe(200);
    expect(clear.json().deprecatedMessage).toBeNull();
  });

  it('rejects deprecating a release of an archived skill', async () => {
    await upload('reviewer');
    await publish('@alice/reviewer', '1.0.0');
    await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/archive',
      headers: { authorization: 'token alice-token' },
      payload: {}
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases/1.0.0/deprecate',
      headers: { authorization: 'token alice-token' },
      payload: { message: 'too late' }
    });

    expect(response.statusCode).toBe(409);
  });

  it('deletes a single release and burns its version number', async () => {
    await upload('reviewer');
    await publish('@alice/reviewer', '1.0.0');
    await publish('@alice/reviewer', '0.9.0');

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases/0.9.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '0.9.0' }
    });

    expect(response.statusCode).toBe(200);

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().versions).toEqual(['1.0.0']);
    expect(info.json().releases.map((release: { version: string }) => release.version)).toEqual(['1.0.0']);
    // The remaining release is untouched.
    expect(info.json().packageUrl).toContain('/1.0.0/');

    // The deleted version number stays burned.
    const republish = await publish('@alice/reviewer', '0.9.0');
    expect(republish.statusCode).toBe(409);
  });

  it('requires the version as confirmation before deleting a release', async () => {
    await upload('reviewer');
    await publish('@alice/reviewer', '1.0.0');

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases/1.0.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: 'not-the-version' }
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses to delete a release another skill depends on unless a platform administrator forces it', async () => {
    await upload('dep');
    await publish('@alice/dep', '1.0.0');
    await upload('reviewer');
    await publish('@alice/reviewer', '1.0.0', { '@alice/dep': '^1.0.0' });

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/dep/releases/1.0.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '1.0.0' }
    });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain('@alice/reviewer');

    // A maintainer cannot force it ...
    const maintainerForce = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/dep/releases/1.0.0/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '1.0.0', force: true }
    });
    expect(maintainerForce.statusCode).toBe(403);

    // ... a platform administrator can.
    gitea.validateAdminUserToken = vi.fn().mockResolvedValue({ username: 'eslroot' });
    const adminForce = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/dep/releases/1.0.0/delete',
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        },
        files: {
          'SKILL.md': '---\nname: reviewer\n---\n',
          'release.json': JSON.stringify({
            schemaVersion: 3,
            name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer',
      headers: {
        host: 'api:3000',
        'x-forwarded-host': 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: 'token alice-token'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cloneUrl: 'http://localhost:3000/git/alice/reviewer.git',
      packageUrl: expect.stringContaining('http://localhost:3000/api/packages/')
    });
  });

  it('uses release.json from the source commit instead of client metadata', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 3,
        name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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
        schemaVersion: 3,
        name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases/1.0.0/repair-tag',
      headers: { authorization: 'token alice-token' }
    });
    expect(repair.statusCode).toBe(200);
    expect(repair.json()).toMatchObject({ repaired: true, tag: 'v1.0.0', sourceCommit: 'abc123' });

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
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
        schemaVersion: 3,
        name: '@alice/reviewer',
        version: '0.1.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      }
    };
    await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: { ...payload, sourceCommit: 'different' }
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().message).toContain('already exists');
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('points to');
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases/1.0.0/repair-tag',
      headers: { authorization: 'token alice-token' }
    });

    expect(repair.statusCode).toBe(200);
    expect(repair.json()).toMatchObject({
      repaired: true,
      tag: 'v1.0.0',
      sourceCommit: 'abc123'
    });
    expect(gitea.createReleaseTag).toHaveBeenLastCalledWith(
      'alice',
      'reviewer',
      'v1.0.0',
      'abc123',
      'Release @alice/reviewer 1.0.0'
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases/1.0.0/repair-tag',
      headers: { authorization: 'token alice-token' }
    });

    expect(repair.statusCode).toBe(409);
    expect(repair.json().message).toContain('points to');
    expect(gitea.createReleaseTag).toHaveBeenCalledTimes(1);
  });

  it('stores the release notes and uses them as the release tag message', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 3,
        name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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
      'alice',
      'reviewer',
      'v1.0.0',
      'abc123',
      '- fix: dead-link regex\n- feat: docx batch'
    );

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().releases[0].notes).toBe('- fix: dead-link regex\n- feat: docx batch');
  });

  it('lets a maintainer update the release notes after publishing', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 3,
        name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases/1.0.0/notes',
      headers: { authorization: 'token alice-token' },
      payload: { message: 'revised note' }
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().notes).toBe('revised note');
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().releases[0].notes).toBe('revised note');
  });

  it('rejects updating release notes by a non-maintainer', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify({
        schemaVersion: 3,
        name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 3,
          name: '@alice/reviewer',
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
      url: '/api/skills/@alice/reviewer/releases/1.0.0/notes',
      headers: { authorization: 'token bob-token' },
      payload: { message: 'revised' }
    });

    expect(update.statusCode).toBe(403);
  });

  it('freezes a transitive diamond once, at the highest version in the intersection', async () => {
    await upload('d');
    await publish('@alice/d', '1.2.0');
    await publish('@alice/d', '1.3.0');
    await publish('@alice/d', '1.4.0');
    await upload('b');
    await publish('@alice/b', '1.0.0', { '@alice/d': '^1.2.0' });
    await upload('c');
    await publish('@alice/c', '1.0.0', { '@alice/d': '~1.3.0' });
    await upload('reviewer');

    const response = await publish('@alice/reviewer', '1.0.0', {
      '@alice/b': '^1.0.0',
      '@alice/c': '^1.0.0'
    });

    expect(response.statusCode).toBe(201);
    const lock = response.json().dependencyLock;
    expect(Object.keys(lock).filter((key: string) => key === '@alice/d')).toHaveLength(1);
    expect(lock['@alice/d']).toMatchObject({
      skillId: expect.stringMatching(/^sk_/),
      version: '1.3.0',
      checksum: expect.stringMatching(/^sha256-/)
    });
  });

  it('rejects dependency ranges with no intersection using a stable error code', async () => {
    // 沿发布时间线：d 1.0.0 让 b 冻锁成功；d 2.0.0 让 c 冻锁成功；根汇合时冲突。
    await upload('d');
    await publish('@alice/d', '1.0.0');
    await upload('b');
    await publish('@alice/b', '1.0.0', { '@alice/d': '^1.0.0' });
    await publish('@alice/d', '2.0.0');
    await upload('c');
    await publish('@alice/c', '1.0.0', { '@alice/d': '^2.0.0' });
    await upload('reviewer');

    const response = await publish('@alice/reviewer', '1.0.0', {
      '@alice/b': '^1.0.0',
      '@alice/c': '^1.0.0'
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('releaseDependencyRangesDoNotIntersect');
  });

  it('rejects a dependency cycle, including self-dependency', async () => {
    // 环只能沿发布时间线形成：a@1 先无边发布；b@1 依赖 a；a@2 再依赖 b。
    await upload('a');
    await publish('@alice/a', '1.0.0');
    await upload('b');
    await publish('@alice/b', '1.0.0', { '@alice/a': '^1.0.0' });

    const cyclic = await publish('@alice/a', '2.0.0', { '@alice/b': '^1.0.0' });
    expect(cyclic.statusCode).toBe(409);
    expect(cyclic.json().code).toBe('releaseDependencyCycle');

    const selfCycle = await publish('@alice/a', '3.0.0', { '@alice/a': '^1.0.0' });
    expect(selfCycle.statusCode).toBe(409);
    expect(selfCycle.json().code).toBe('releaseDependencyCycle');
  });

  it('rejects reserved-scope and file targets even when hand-edited into the manifest', async () => {
    await upload('reviewer');
    for (const target of ['@builtin/foo', '@local/foo', 'file:./foo']) {
      const response = await publish('@alice/reviewer', '1.0.0', { [target]: '^1.0.0' });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('releaseDependencyTargetInvalid');
    }
  });

  it('rejects a target with no published release, or no version satisfying the range', async () => {
    await upload('reviewer');
    const missing = await publish('@alice/reviewer', '1.0.0', { '@alice/ghost': '^1.0.0' });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe('releaseDependencyNoRelease');

    await upload('dep');
    await publish('@alice/dep', '1.0.0');
    await publish('@alice/dep', '2.0.0');
    const unsatisfiable = await publish('@alice/reviewer', '1.1.0', { '@alice/dep': '~1.5.0' });
    expect(unsatisfiable.statusCode).toBe(409);
    expect(unsatisfiable.json().code).toBe('releaseDependencyNoSatisfyingVersion');
  });

  it('rejects publishing when the publisher cannot read a dependency', async () => {
    await upload('dep');
    await publish('@alice/dep', '1.0.0');
    await setVisibility('@alice/dep', 'private');

    // Bob 发布自己的根，读不到 alice 的私有依赖。
    gitea.validateToken.mockResolvedValue({ username: 'bob' });
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token bob-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@bob/reviewer/releases',
      headers: { authorization: 'token bob-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'commit-1.0.0',
        releaseManifest: {
          schemaVersion: 3,
          name: '@bob/reviewer',
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: { '@alice/dep': '^1.0.0' }
        },
        files: {
          ...SKILL_FILES,
          'release.json': JSON.stringify({
            schemaVersion: 3,
            name: '@bob/reviewer',
            version: '0.1.0',
            license: 'MIT',
            keywords: [],
            compatibility: {},
            dependencies: { '@alice/dep': '^1.0.0' }
          })
        }
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('releaseDependencyNotVisible');
  });

  it('rejects a public root depending on a private skill, but allows it for a private root', async () => {
    await upload('dep');
    await publish('@alice/dep', '1.0.0');
    await setVisibility('@alice/dep', 'private');

    await upload('public-root');
    await setVisibility('@alice/public-root', 'public');
    const publicRoot = await publish('@alice/public-root', '1.0.0', { '@alice/dep': '^1.0.0' });
    expect(publicRoot.statusCode).toBe(409);
    expect(publicRoot.json().code).toBe('releaseDependencyPublicChainMustBePublic');

    await upload('private-root');
    await setVisibility('@alice/private-root', 'private');
    const privateRoot = await publish('@alice/private-root', '1.0.0', { '@alice/dep': '^1.0.0' });
    expect(privateRoot.statusCode).toBe(201);
    expect(privateRoot.json().dependencyLock['@alice/dep'].version).toBe('1.0.0');
  });

  it('runs the same freeze checks on --dry-run without creating a release', async () => {
    await upload('dep');
    await publish('@alice/dep', '1.0.0');
    await upload('reviewer');

    const response = await dryRunPublish('@alice/reviewer', { '@alice/dep': '^1.0.0' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      dryRun: true,
      dependencyLock: { '@alice/dep': { version: '1.0.0' } }
    });

    // 没有创建 Skill Release，也没有写新包目录。
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().releases).toEqual([]);

    const badGraph = await dryRunPublish('@alice/reviewer', { '@alice/ghost': '^1.0.0' });
    expect(badGraph.statusCode).toBe(409);
    expect(badGraph.json().code).toBe('releaseDependencyNoRelease');
  });

  it('uses the request files in --dry-run when the unpushed commit is not on the server', async () => {
    gitea.readSourceTree = vi.fn().mockRejectedValue(new Error('unknown commit'));
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });

    const response = await dryRunPublish('@alice/reviewer', {});

    expect(response.statusCode).toBe(200);
    expect(gitea.readSourceTree).toHaveBeenCalledWith('alice', 'reviewer', 'unpushed-commit');
  });
});
