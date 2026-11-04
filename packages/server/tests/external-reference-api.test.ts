import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePublishedSkillPackage } from '@esl/core';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

const execFileAsync = promisify(execFile);

// Git 克隆与提交在 CI/Windows 并行运行时可能超过默认 5 秒。
vi.setConfig({ testTimeout: 20_000 });

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], { cwd });
}

describe('External Reference API', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let upstreamRoot: string;
  let upstreamDir: string;
  let gitea: ReturnType<typeof makeGitea>;

  function makeGitea() {
    return {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      validateAdminUserToken: vi.fn().mockResolvedValue(null),
      validateUserToken: undefined as never,
      adminUsername: 'eslroot',
      listOrgMembers: vi.fn().mockResolvedValue(['alice']),
      listRepoTeams: vi.fn().mockResolvedValue([]),
      isTeamMember: vi.fn().mockResolvedValue(false),
      getCollaboratorPermission: vi.fn().mockResolvedValue(null),
      // 外部引用没有 Gitea 侧仓库：归档外部技能时必须跳过该调用。
      setRepositoryArchived: vi.fn().mockRejectedValue(new Error('404 repository does not exist')),
      createRepo: vi.fn(),
      addCollaborator: vi.fn()
    };
  }

  beforeEach(async () => {
    upstreamRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'esl-extapi-up-'));
    upstreamDir = path.join(upstreamRoot, 'upstream.git');
    await fsp.mkdir(upstreamDir, { recursive: true });
    await git(['init', '-b', 'main'], upstreamDir);
    await fsp.mkdir(path.join(upstreamDir, 'webapp-testing'), { recursive: true });
    await fsp.writeFile(
      path.join(upstreamDir, 'webapp-testing', 'SKILL.md'),
      '---\nname: webapp-testing\ndescription: Up\n---\n# hi\n'
    );
    await fsp.writeFile(path.join(upstreamDir, 'webapp-testing', 'note.txt'), 'v1');
    await fsp.writeFile(
      path.join(upstreamDir, 'LICENSE'),
      'MIT License\n\nPermission is hereby granted, free of charge\n'
    );
    await git(['add', '.'], upstreamDir);
    await git(['commit', '-m', 'initial'], upstreamDir);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-extapi-'));
    const db = initDatabase(path.join(tmpDir, 'test.db'));
    new TenantOrganizationRepository(db).create({ orgName: 'platform-ai', status: 'active' });
    db.close();
    gitea = makeGitea();
    app = buildApp({
      dbPath: path.join(tmpDir, 'test.db'),
      packageRoot: path.join(tmpDir, 'packages'),
      externalFetchRoot: path.join(tmpDir, 'fetch-work'),
      giteaService: gitea as never,
      repoOwner: 'platform-ai'
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await fsp.rm(upstreamRoot, { recursive: true, force: true });
  });

  const auth = { authorization: 'token alice-token' };

  it('预览：解析默认分支并检测到许可证来源', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-references/preview',
      headers: auth,
      payload: {
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE']
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.branch).toBe('main');
    expect(body.skillName).toBe('webapp-testing');
    expect(body.description).toBe('Up');
    expect(body.detectedLicense).toBe('MIT');
    expect(body.licenseProvenance.path).toBe('LICENSE');
    expect(body.files).toContain('SKILL.md');
    // 祖先目录中的 LICENSE 作为候选返回，供管理者选择。
    expect(body.licenseCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'LICENSE', insideSkillDirectory: false })
      ])
    );
  });

  it('创建引用并经许可证确认后发布 0.1.0，可通过详情读取', async () => {
    // 先创建（未确认许可证 → 不发布）。
    const create = await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE'],
        visibility: 'private',
        schedule: { frequency: 'daily', time: '09:00', timeZone: 'UTC' }
      }
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().initialSync.outcome).toBe('license-confirmation-required');
    // 名称与描述自动来自上游 SKILL.md。
    expect(create.json().skillName).toBe('@alice/webapp-testing');
    expect(create.json().description).toBe('Up');

    // 确认许可证。
    const license = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/license',
      headers: auth,
      payload: { basis: 'MIT', extraFiles: ['LICENSE'] }
    });
    expect(license.statusCode).toBe(200);

    // 立即同步。
    const sync = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().outcome).toBe('published');
    expect(sync.json().version).toBe('0.1.0');

    // 详情包含来源、分支、commit、状态与计划。
    const detail = await app.inject({
      method: 'GET',
      url: '/api/external-references/@alice/webapp-testing',
      headers: auth
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      branch: 'main',
      skillDirectory: 'webapp-testing',
      description: 'Up',
      latestVersion: '0.1.0',
      syncState: 'idle',
      locked: true
    });
  });

  it('创建时确认许可证可直接发布 0.1.0', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE'],
        confirmLicense: true
      }
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().initialSync.outcome).toBe('published');
    expect(create.json().initialSync.version).toBe('0.1.0');
    expect(create.json()).toMatchObject({
      skillName: '@alice/webapp-testing',
      description: 'Up',
      latestVersion: '0.1.0',
      locked: true
    });
    expect(create.json().license.confirmedAt).not.toBeNull();
  });

  it('重名引用被拒绝', async () => {
    const payload = {
      scope: 'alice',
      repositoryUrl: upstreamDir,
      skillDirectory: 'webapp-testing'
    };
    await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('skillNameAlreadyExists');
  });

  it('非 HTTPS 地址预览被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/external-references/preview',
      headers: auth,
      payload: { repositoryUrl: 'http://example.com/repo.git', skillDirectory: '' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('externalSourceHttpsRequired');
  });

  it('暂停后立即同步被拒绝；恢复后可补跑', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE']
      }
    });
    const pause = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/pause',
      headers: auth
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().syncState).toBe('paused');

    // 暂停期间立即同步被拒绝（409），且状态仍保持暂停。
    const syncWhilePaused = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });
    expect(syncWhilePaused.statusCode).toBe(409);
    expect(syncWhilePaused.json().code).toBe('externalSourcePaused');

    const resume = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/resume',
      headers: auth
    });
    expect(resume.json().catchupDue).toBe(true);
    expect(resume.json().syncState).toBe('idle');
  });

  it('归档停止同步；恢复后默认保持暂停，需显式恢复', async () => {
    // 创建并发布。
    await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE']
      }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/license',
      headers: auth,
      payload: { basis: 'MIT', extraFiles: ['LICENSE'] }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });

    // 归档。
    const archive = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/webapp-testing/archive',
      headers: auth
    });
    expect(archive.json().status).toBe('archived');
    // 外部引用不存在 Gitea 仓库，归档不得调用 Git Backend 归档接口。
    expect(gitea.setRepositoryArchived).not.toHaveBeenCalled();
    // 归档后立即同步应失败（已归档）。
    const syncArchived = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });
    expect(syncArchived.statusCode).not.toBe(200);

    // 恢复：技能恢复，但外部引用默认保持暂停。
    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/webapp-testing/restore',
      headers: auth
    });
    expect(restoreRes.statusCode).toBe(200);
    const detail = await app.inject({
      method: 'GET',
      url: '/api/external-references/@alice/webapp-testing',
      headers: auth
    });
    expect(detail.json().syncState).toBe('paused');

    // 显式恢复同步后才会回到计划并标记补跑。
    const resume = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/resume',
      headers: auth
    });
    expect(resume.json().syncState).toBe('idle');
    expect(resume.json().catchupDue).toBe(true);
  });

  it('首次发布前可修正来源；锁定后拒绝改来源但仍可改计划', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        branch: 'main',
        extraFiles: ['LICENSE']
      }
    });

    // 未锁定：可改目录与分支。
    const beforeLock = await app.inject({
      method: 'PATCH',
      url: '/api/external-references/@alice/webapp-testing',
      headers: auth,
      payload: { skillDirectory: 'webapp-testing', branch: 'main' }
    });
    expect(beforeLock.statusCode).toBe(200);

    // 确认许可并发布 → 锁定来源。
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/license',
      headers: auth,
      payload: { basis: 'MIT', extraFiles: ['LICENSE'] }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });

    const afterLock = await app.inject({
      method: 'PATCH',
      url: '/api/external-references/@alice/webapp-testing',
      headers: auth,
      payload: { branch: 'other' }
    });
    expect(afterLock.statusCode).toBe(409);
    expect(afterLock.json().code).toBe('externalSourceLocked');

    // 计划仍可独立修改。
    const scheduleUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/external-references/@alice/webapp-testing',
      headers: auth,
      payload: { schedule: { frequency: 'weekly', weekday: 3, time: '10:00', timeZone: 'UTC' } }
    });
    expect(scheduleUpdate.statusCode).toBe(200);
    expect(scheduleUpdate.json().schedule).toMatchObject({ frequency: 'weekly', weekday: 3 });
  });

  it('首次发布后可编辑来源 URL，保存不发版并保留技能身份与历史', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE']
      }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/license',
      headers: auth,
      payload: { basis: 'MIT', extraFiles: ['LICENSE'] }
    });
    const firstSync = await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });
    expect(firstSync.json().version).toBe('0.1.0');

    // 构造一个内容有变化的上游 fork。
    const forkRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'esl-extapi-fork-'));
    const forkDir = path.join(forkRoot, 'fork.git');
    try {
      await execFileAsync('git', ['clone', upstreamDir, forkDir]);
      await fsp.writeFile(path.join(forkDir, 'webapp-testing', 'note.txt'), 'v2');
      await git(['add', '.'], forkDir);
      await git(['commit', '-m', 'fork change'], forkDir);

      const update = await app.inject({
        method: 'PATCH',
        url: '/api/external-references/@alice/webapp-testing',
        headers: auth,
        payload: { repositoryUrl: forkDir }
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().repositoryUrl).toBe(forkDir);
      // 目录与分支保持锁定，技能身份与历史版本不变。
      expect(update.json()).toMatchObject({
        skillName: '@alice/webapp-testing',
        skillDirectory: 'webapp-testing',
        branch: 'main',
        locked: true,
        latestVersion: '0.1.0'
      });
      // 新来源需要重新确认许可；保存地址本身不产生新版本。
      expect(update.json().license.confirmedAt).toBeNull();

      const pending = await app.inject({
        method: 'POST',
        url: '/api/external-references/@alice/webapp-testing/sync',
        headers: auth
      });
      expect(pending.json().outcome).toBe('license-confirmation-required');

      await app.inject({
        method: 'POST',
        url: '/api/external-references/@alice/webapp-testing/license',
        headers: auth,
        payload: { basis: 'MIT', extraFiles: ['LICENSE'] }
      });
      const secondSync = await app.inject({
        method: 'POST',
        url: '/api/external-references/@alice/webapp-testing/sync',
        headers: auth
      });
      expect(secondSync.json().outcome).toBe('published');
      expect(secondSync.json().version).toBe('0.1.1');

      const detail = await app.inject({
        method: 'GET',
        url: '/api/external-references/@alice/webapp-testing',
        headers: auth
      });
      expect(detail.json()).toMatchObject({
        skillName: '@alice/webapp-testing',
        latestVersion: '0.1.1',
        repositoryUrl: forkDir
      });
    } finally {
      await fsp.rm(forkRoot, { recursive: true, force: true });
    }
  });

  it('来源验证失败时不写入任何变更', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE']
      }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/license',
      headers: auth,
      payload: { basis: 'MIT', extraFiles: ['LICENSE'] }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });

    // 新来源没有许可证，却要求一并确认：应拒绝，且保留原来源与确认状态。
    const noLicenseRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'esl-extapi-nolicense-'));
    const noLicenseDir = path.join(noLicenseRoot, 'repo.git');
    try {
      await execFileAsync('git', ['clone', upstreamDir, noLicenseDir]);
      await fsp.rm(path.join(noLicenseDir, 'LICENSE'), { force: true });
      await git(['add', '-A'], noLicenseDir);
      await git(['commit', '-m', 'drop license'], noLicenseDir);

      const rejected = await app.inject({
        method: 'PATCH',
        url: '/api/external-references/@alice/webapp-testing',
        headers: auth,
        payload: { repositoryUrl: noLicenseDir, extraFiles: [], confirmLicense: true }
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().code).toBe('externalSourceLicenseConfirmationRequired');

      const detail = await app.inject({
        method: 'GET',
        url: '/api/external-references/@alice/webapp-testing',
        headers: auth
      });
      expect(detail.json().repositoryUrl).toBe(upstreamDir);
      expect(detail.json().license.confirmedAt).not.toBeNull();
    } finally {
      await fsp.rm(noLicenseRoot, { recursive: true, force: true });
    }
  });

  it('发布的外部 Release 保留上游文件字节', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/external-references',
      headers: auth,
      payload: {
        scope: 'alice',
        repositoryUrl: upstreamDir,
        skillDirectory: 'webapp-testing',
        extraFiles: ['LICENSE']
      }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/license',
      headers: auth,
      payload: { basis: 'MIT', extraFiles: ['LICENSE'] }
    });
    await app.inject({
      method: 'POST',
      url: '/api/external-references/@alice/webapp-testing/sync',
      headers: auth
    });
    // 通过 Release 列表拿到消费者下载地址，验证上游文件字节被原样保留。
    const releasesRes = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/webapp-testing',
      headers: auth
    });
    expect(releasesRes.statusCode).toBe(200);
    const release = releasesRes.json().releases[0];
    const packagePathOnly = new URL(release.packageUrl, 'http://localhost').pathname;
    const download = await app.inject({ method: 'GET', url: packagePathOnly, headers: auth });
    expect(download.statusCode).toBe(200);
    const parsed = await parsePublishedSkillPackage(download.rawPayload);
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.files['note.txt'].toString('utf8')).toBe('v1');
  });
});
