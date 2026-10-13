import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, purgeExpiredDownloadLogs } from '../src/app.js';
import { DownloadLogRepository, initDatabase, type DownloadLogRecord } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

// 超管下载日志明细查询（ADR-0067 / #131）：明细含用户名与截断 IP 段，只有
// Super Administrator 能查；技能 Owner 与普通用户一律 403。
describe('download log admin query API', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let raw: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-dl-admin-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({ users: [{ username: 'alice', password: 'alice-password' }] });
    gitea.__state.tokens.set('root-token', 'eslroot');
    gitea.__state.tokens.set('alice-token', 'alice');
    initDatabase(dbPath).close();
    app = buildApp({ dbPath, giteaService: gitea as never, repoOwner: 'acme' });
    raw = new Database(dbPath);
  });

  afterEach(async () => {
    raw.close();
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedLog(
    input: Partial<DownloadLogRecord> & { result: 'success' | 'failure' },
    at: Date
  ): void {
    new DownloadLogRepository(raw).record(
      { skillId: 'sk_default', skillIdentity: '@acme/default', version: '1.0.0', ...input },
      at
    );
  }

  function query(
    search: string,
    token = 'root-token'
  ): Promise<{ statusCode: number; json: () => unknown }> {
    return app.inject({
      method: 'GET',
      url: `/api/admin/download-logs${search}`,
      headers: { authorization: `token ${token}` }
    });
  }

  function seedMixedLogs(): void {
    seedLog(
      { skillId: 'sk_a', skillIdentity: '@acme/a', version: '1.0.0', username: 'alice' , result: 'success' },
      daysAgo(10)
    );
    seedLog(
      {
        skillId: 'sk_b',
        skillIdentity: '@acme/b',
        version: '2.0.0',
        username: 'bob',
        result: 'failure',
        failureReason: 'skillNotFound'
      },
      daysAgo(5)
    );
  }

  it('returns paginated detail rows to the Super Administrator', async () => {
    seedMixedLogs();

    const response = await query('');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number };
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.items).toHaveLength(2);
    // 时间倒序：最新的失败行在前。
    expect(body.items[0]).toMatchObject({
      skillIdentity: '@acme/b',
      username: 'bob',
      result: 'failure',
      failureReason: 'skillNotFound'
    });
    expect(body.items[1]).toMatchObject({ skillIdentity: '@acme/a', result: 'success' });
  });

  it('filters by skill identity or Skill ID, user, result and time range', async () => {
    seedMixedLogs();

    const byIdentity = await query('?skill=%40acme%2Fa');
    expect((byIdentity.json() as { items: unknown[] }).items).toHaveLength(1);

    const bySkillId = await query('?skill=sk_b');
    expect((bySkillId.json() as { items: Array<{ skillId: string }> }).items[0].skillId).toBe('sk_b');

    const byUser = await query('?username=bob');
    expect((byUser.json() as { items: unknown[] }).items).toHaveLength(1);

    const byResult = await query('?result=failure');
    expect((byResult.json() as { items: unknown[] }).items).toHaveLength(1);

    const inRange = await query(`?from=${daysAgo(7).toISOString()}`);
    expect((inRange.json() as { items: Array<{ skillIdentity: string }> }).items).toEqual([
      expect.objectContaining({ skillIdentity: '@acme/b' })
    ]);

    const outOfRange = await query(`?to=${daysAgo(7).toISOString()}`);
    expect((outOfRange.json() as { items: Array<{ skillIdentity: string }> }).items).toEqual([
      expect.objectContaining({ skillIdentity: '@acme/a' })
    ]);
  });

  it('paginates with page and pageSize', async () => {
    seedMixedLogs();

    const firstPage = await query('?page=1&pageSize=1');
    expect((firstPage.json() as { items: unknown[]; total: number }).items).toHaveLength(1);
    expect((firstPage.json() as { total: number }).total).toBe(2);

    const secondPage = await query('?page=2&pageSize=1');
    expect((secondPage.json() as { items: Array<{ skillIdentity: string }> }).items[0].skillIdentity).toBe(
      '@acme/a'
    );

    const beyondEnd = await query('?page=9&pageSize=1');
    expect((beyondEnd.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('rejects invalid query parameters with a dedicated error code', async () => {
    for (const search of [
      '?result=maybe',
      '?page=0',
      '?page=abc',
      '?page=100001',
      '?pageSize=999',
      '?from=not-a-date',
      `?from=${daysAgo(1).toISOString()}&to=${daysAgo(9).toISOString()}`
    ]) {
      const response = await query(search);
      expect(response.statusCode, search).toBe(400);
      expect((response.json() as { code: string }).code, search).toBe('invalidDownloadLogQuery');
    }
  });

  it('denies non Super Administrators and unauthenticated callers', async () => {
    seedMixedLogs();

    const asSkillUser = await query('', 'alice-token');
    expect(asSkillUser.statusCode).toBe(403);
    expect((asSkillUser.json() as { code: string }).code).toBe(
      'forbiddenSuperAdministratorTokenRequired'
    );

    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/download-logs' });
    expect(anonymous.statusCode).toBe(401);
  });
});

// 90 天保留策略（ADR-0067 / #131）：清理删除过期明细，聚合计数永久保留。
describe('download log retention', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-dl-retention-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildGitea(): GlobalGiteaFake {
    return createGlobalGitea({ users: [] });
  }

  it('deletes expired detail rows at startup while keeping aggregate counts', () => {
    const db = initDatabase(dbPath);
    const repository = new DownloadLogRepository(db);
    repository.record(
      { skillId: 'sk_old', skillIdentity: '@acme/old', version: '1.0.0', username: 'alice', result: 'success' },
      daysAgo(100)
    );
    repository.record(
      { skillId: 'sk_new', skillIdentity: '@acme/new', version: '1.0.0', username: 'alice', result: 'success' },
      daysAgo(1)
    );
    db.close();

    // 启动触发一次清理（本仓库首个周期任务）。
    app = buildApp({ dbPath, giteaService: buildGitea() as never, repoOwner: 'acme' });

    const raw = new Database(dbPath);
    const rows = raw.prepare(`SELECT skill_identity FROM download_logs ORDER BY id`).all() as Array<{
      skill_identity: string;
    }>;
    const counts = raw
      .prepare(`SELECT skill_id, count FROM download_counts WHERE version = '' AND day = '' ORDER BY skill_id`)
      .all() as Array<{ skill_id: string; count: number }>;
    raw.close();

    expect(rows.map((row) => row.skill_identity)).toEqual(['@acme/new']);
    // 明细过期不影响聚合：两个技能的公开下载量都保留。
    expect(counts).toEqual([
      { skill_id: 'sk_new', count: 1 },
      { skill_id: 'sk_old', count: 1 }
    ]);
  });

  it('purges only rows older than the 90 day retention window', () => {
    const db = initDatabase(dbPath);
    const repository = new DownloadLogRepository(db);
    repository.record(
      { skillId: 'sk_expired', skillIdentity: '@acme/expired', result: 'success' },
      daysAgo(91)
    );
    repository.record(
      { skillId: 'sk_kept', skillIdentity: '@acme/kept', result: 'success' },
      daysAgo(89)
    );

    const removed = purgeExpiredDownloadLogs(repository);

    expect(removed).toBe(1);
    const remaining = db.prepare(`SELECT skill_identity FROM download_logs`).all() as Array<{
      skill_identity: string;
    }>;
    expect(remaining).toEqual([{ skill_identity: '@acme/kept' }]);
    db.close();
  });
});
