import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePublishedSkillPackage, type CalendarSchedule } from '@esl/core';
import {
  initDatabase,
  SkillRepository,
  ExternalSourceRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';
import { ExternalGitFetcher } from '../src/services/external-git-fetcher.js';
import { synchronizeExternalReference } from '../src/services/external-sync-service.js';
import type Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], { cwd });
}

const schedule: CalendarSchedule = { frequency: 'daily', time: '09:00', timeZone: 'UTC' };

describe('External sync service', () => {
  let tmpDir: string;
  let db: Database.Database;
  let upstreamRoot: string;
  let upstreamDir: string;
  let skillRepository: SkillRepository;
  let externalSourceRepository: ExternalSourceRepository;
  let fetcher: ExternalGitFetcher;
  let gitea: Record<string, unknown>;

  async function buildUpstream(): Promise<void> {
    upstreamRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'esl-sync-up-'));
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
  }

  beforeEach(async () => {
    await buildUpstream();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-sync-'));
    db = initDatabase(path.join(tmpDir, 'test.db'));
    new TenantOrganizationRepository(db).create({ orgName: 'platform-ai', status: 'active' });
    skillRepository = new SkillRepository(db);
    externalSourceRepository = new ExternalSourceRepository(db);

    // 先建技能身份（模拟创建引用时落 skill 行）。
    skillRepository.createServerSkill({
      name: '@alice/webapp-testing',
      scope: 'alice',
      skillName: 'webapp-testing',
      description: '',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: [],
      visibility: 'private',
      status: 'active-unreleased',
      gitRepoPath: 'alice/webapp-testing'
    });
    externalSourceRepository.create({
      skillName: '@alice/webapp-testing',
      repositoryUrl: upstreamDir,
      skillDirectory: 'webapp-testing',
      branch: 'main',
      schedule,
      extraFiles: []
    });

    fetcher = new ExternalGitFetcher({ workRoot: path.join(tmpDir, 'fetch-work') });
    gitea = {
      adminUsername: 'eslroot',
      listRepoTeams: async () => [],
      isTeamMember: async () => false,
      getCollaboratorPermission: async () => null
    };
  });

  afterEach(async () => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await fsp.rm(upstreamRoot, { recursive: true, force: true });
  });

  function deps(): Parameters<typeof synchronizeExternalReference>[0] {
    return {
      skillRepository,
      externalSourceRepository,
      giteaService: gitea as never,
      fetcher,
      packageRoot: path.join(tmpDir, 'packages')
    };
  }

  // 目录外许可证文件必须被明确确认纳入，才会参与抓取与检测（ADR-0074）。
  function confirmLicense(basis = 'MIT'): void {
    externalSourceRepository.updateExtraFiles('@alice/webapp-testing', ['LICENSE']);
    externalSourceRepository.confirmLicense({
      skillName: '@alice/webapp-testing',
      basis,
      provenance: { path: 'LICENSE', source: 'file' },
      confirmedBy: 'alice'
    });
  }

  it('首次同步：无许可证确认时不发布，要求确认', async () => {
    const result = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(result.outcome).toBe('license-confirmation-required');
    expect(skillRepository.getReleases('@alice/webapp-testing')).toHaveLength(0);
  });

  it('确认许可证后首次发布为 0.1.0，保留原始字节与独立上游 commit', async () => {
    confirmLicense();
    const result = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(result.outcome).toBe('published');
    expect(result.version).toBe('0.1.0');
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);

    const releases = skillRepository.getReleases('@alice/webapp-testing');
    expect(releases).toHaveLength(1);
    const packageBytes = await fsp.readFile(releases[0].packagePath);
    const parsed = await parsePublishedSkillPackage(packageBytes);
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.sourceCommit).toBe(result.commit);
    expect(parsed.files['note.txt'].toString('utf8')).toBe('v1');
    // 上游 SKILL.md 必须保持原始字节，不得为身份校验改写。
    expect(parsed.files['SKILL.md'].toString('utf8')).toBe(
      '---\nname: webapp-testing\ndescription: Up\n---\n# hi\n'
    );
    // 发布后来源被锁定。
    expect(externalSourceRepository.get('@alice/webapp-testing')?.locked).toBe(true);
  });

  it('无内容变化时不发版，结果为 unchanged', async () => {
    confirmLicense();
    await synchronizeExternalReference(deps(), '@alice/webapp-testing', { username: 'alice' });
    const again = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(again.outcome).toBe('unchanged');
    expect(skillRepository.getReleases('@alice/webapp-testing')).toHaveLength(1);
  });

  it('内容修改后递增 patch 并记录新 commit', async () => {
    confirmLicense();
    await synchronizeExternalReference(deps(), '@alice/webapp-testing', { username: 'alice' });

    await fsp.writeFile(path.join(upstreamDir, 'webapp-testing', 'note.txt'), 'v2');
    await git(['add', '.'], upstreamDir);
    await git(['commit', '-m', 'update'], upstreamDir);

    const result = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(result.outcome).toBe('published');
    expect(result.version).toBe('0.1.1');
  });

  it('仓库无关目录变化不触发发布', async () => {
    confirmLicense();
    await synchronizeExternalReference(deps(), '@alice/webapp-testing', { username: 'alice' });

    await fsp.mkdir(path.join(upstreamDir, 'other-skill'), { recursive: true });
    await fsp.writeFile(path.join(upstreamDir, 'other-skill', 'SKILL.md'), 'name: other');
    await git(['add', '.'], upstreamDir);
    await git(['commit', '-m', 'unrelated'], upstreamDir);

    const result = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(result.outcome).toBe('unchanged');
  });

  it('抓取失败保留最后成功版本并可重试恢复', async () => {
    confirmLicense();
    await synchronizeExternalReference(deps(), '@alice/webapp-testing', { username: 'alice' });

    // 删除上游分支模拟故障。
    await git(['branch', '-m', 'main', 'renamed'], upstreamDir);
    const failed = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(failed.outcome).toBe('failed');
    // 最后成功版本仍在。
    expect(skillRepository.getReleases('@alice/webapp-testing')).toHaveLength(1);

    await git(['branch', '-m', 'renamed', 'main'], upstreamDir);
    const recovered = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(['unchanged', 'published']).toContain(recovered.outcome);
  });

  it('许可证变化时暂停发布并要求重新确认，旧版保留', async () => {
    confirmLicense();
    await synchronizeExternalReference(deps(), '@alice/webapp-testing', { username: 'alice' });

    // 上游改用 Apache。
    await fsp.writeFile(
      path.join(upstreamDir, 'LICENSE'),
      'Apache License\nVersion 2.0, January 2004\n'
    );
    await fsp.writeFile(path.join(upstreamDir, 'webapp-testing', 'note.txt'), 'apache-change');
    await git(['add', '.'], upstreamDir);
    await git(['commit', '-m', 'relicense'], upstreamDir);

    const result = await synchronizeExternalReference(
      deps(),
      '@alice/webapp-testing',
      { username: 'alice' }
    );
    expect(result.outcome).toBe('license-confirmation-required');
    expect(skillRepository.getReleases('@alice/webapp-testing')).toHaveLength(1);
  });
});
