import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarSchedule } from '@esl/core';
import {
  initDatabase,
  SkillRepository,
  ExternalSourceRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';
import { ExternalGitFetcher } from '../src/services/external-git-fetcher.js';
import {
  runExternalScheduler,
  selectDueReferences
} from '../src/services/external-scheduler.js';
import type Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], { cwd });
}

const schedule: CalendarSchedule = { frequency: 'daily', time: '09:00', timeZone: 'UTC' };

describe('External scheduler', () => {
  let tmpDir: string;
  let db: Database.Database;
  let upstreamRoot: string;
  let skillRepository: SkillRepository;
  let externalSourceRepository: ExternalSourceRepository;
  let fetcher: ExternalGitFetcher;
  let gitea: Record<string, unknown>;

  beforeEach(async () => {
    upstreamRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'esl-sched-up-'));
    const upstreamDir = path.join(upstreamRoot, 'upstream.git');
    await fsp.mkdir(upstreamDir, { recursive: true });
    await git(['init', '-b', 'main'], upstreamDir);
    await fsp.mkdir(path.join(upstreamDir, 'skill-a'), { recursive: true });
    await fsp.writeFile(path.join(upstreamDir, 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: a\n---\n');
    await fsp.writeFile(path.join(upstreamDir, 'LICENSE'), 'MIT License\nfree of charge\n');
    await git(['add', '.'], upstreamDir);
    await git(['commit', '-m', 'init'], upstreamDir);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-sched-'));
    db = initDatabase(path.join(tmpDir, 'test.db'));
    new TenantOrganizationRepository(db).create({ orgName: 'platform-ai', status: 'active' });
    skillRepository = new SkillRepository(db);
    externalSourceRepository = new ExternalSourceRepository(db);
    fetcher = new ExternalGitFetcher({ workRoot: path.join(tmpDir, 'work') });
    gitea = {
      adminUsername: 'eslroot',
      listRepoTeams: async () => [],
      isTeamMember: async () => false,
      getCollaboratorPermission: async () => null
    };

    skillRepository.createServerSkill({
      name: '@alice/skill-a',
      scope: 'alice',
      skillName: 'skill-a',
      description: '',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: [],
      visibility: 'private',
      status: 'active-unreleased',
      gitRepoPath: 'alice/skill-a'
    });
    externalSourceRepository.create({
      skillName: '@alice/skill-a',
      repositoryUrl: upstreamDir,
      skillDirectory: 'skill-a',
      branch: 'main',
      schedule,
      extraFiles: ['LICENSE']
    });
    externalSourceRepository.confirmLicense({
      skillName: '@alice/skill-a',
      basis: 'MIT',
      confirmedBy: 'alice'
    });
  });

  afterEach(async () => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await fsp.rm(upstreamRoot, { recursive: true, force: true });
  });

  const deps = () => ({
    skillRepository,
    externalSourceRepository,
    giteaService: gitea as never,
    fetcher,
    packageRoot: path.join(tmpDir, 'packages')
  });

  it('到期引用被扫描并发布', async () => {
    // next_check_at 已过期（创建时为 null，视为未安排；直接置为过去时间）。
    db.prepare(
      `UPDATE skill_external_sources SET next_check_at = '2000-01-01T00:00:00Z'`
    ).run();
    const now = new Date('2026-11-02T10:00:00Z');
    const due = selectDueReferences(externalSourceRepository, skillRepository, { now });
    expect(due.map((r) => r.skillName)).toContain('@alice/skill-a');

    const scan = await runExternalScheduler(deps(), { now });
    expect(scan.results[0].outcome).toBe('published');
  });

  it('暂停的引用不被调度', async () => {
    externalSourceRepository.markPaused('@alice/skill-a');
    const now = new Date('2026-11-02T10:00:00Z');
    expect(selectDueReferences(externalSourceRepository, skillRepository, { now })).toHaveLength(0);
  });

  it('归档的引用不被调度', async () => {
    skillRepository.archiveSkill('@alice/skill-a');
    const now = new Date('2026-11-02T10:00:00Z');
    db.prepare(
      `UPDATE skill_external_sources SET next_check_at = '2000-01-01T00:00:00Z'`
    ).run();
    expect(selectDueReferences(externalSourceRepository, skillRepository, { now })).toHaveLength(0);
  });

  it('恢复后标记补跑，调度器处理一次后清除标记', async () => {
    externalSourceRepository.markPaused('@alice/skill-a');
    externalSourceRepository.setCatchupDue('@alice/skill-a', true);
    externalSourceRepository.markIdle('@alice/skill-a');

    const now = new Date('2026-11-02T10:00:00Z');
    const scan = await runExternalScheduler(deps(), { now });
    expect(scan.results).toHaveLength(1);
    // 补跑标记在成功后被清除。
    expect(externalSourceRepository.get('@alice/skill-a')?.catchupDue).toBe(false);
  });

  it('重叠触发幂等：已被认领（syncing）的引用不再被选中执行', async () => {
    db.prepare(
      `UPDATE skill_external_sources SET next_check_at = '2000-01-01T00:00:00Z'`
    ).run();
    const now = new Date('2026-11-02T10:00:00Z');
    expect(selectDueReferences(externalSourceRepository, skillRepository, { now })).toHaveLength(1);

    // 手动触发先认领。
    expect(externalSourceRepository.claimForSync('@alice/skill-a')).toBe(true);
    // 认领后处于 syncing，调度不再选中它。
    expect(selectDueReferences(externalSourceRepository, skillRepository, { now })).toHaveLength(0);
    const scan = await runExternalScheduler(deps(), { now });
    expect(scan.results).toHaveLength(0); // 未重复执行
  });
});
