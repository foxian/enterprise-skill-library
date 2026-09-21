import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';
import { createLogCapture, recordsForEvent, type LogCapture } from './helpers/log-capture.js';

// 后台任务日志契约（ADR-0045）：每次执行都记 started / succeeded / failed；
// 独立系统任务挂应用级 logger，请求内任务带 taskId 与触发请求 id。
describe('background task log', () => {
  let tmpDir: string;
  let capture: LogCapture;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-task-log-'));
    capture = createLogCapture();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // seedDevelopmentAccounts 是 fire-and-forget：等事件循环把它跑完再断言。
  const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

  it('records started and succeeded for the independent development seed task', async () => {
    const gitea = createGlobalGitea({
      users: [{ username: 'alice', password: 'a' }],
      orgs: []
    });
    const app = buildApp({
      dbPath: path.join(tmpDir, 'seed.db'),
      giteaService: gitea as never,
      repoOwner: 'esl-skills',
      autoSeed: true,
      logger: capture.logger
    });
    await flushTasks();
    await flushTasks();
    await app.close();

    const started = recordsForEvent(capture, 'task.started');
    const succeeded = recordsForEvent(capture, 'task.succeeded');
    expect(started).toHaveLength(1);
    expect(succeeded).toHaveLength(1);
    expect(started[0]).toMatchObject({ taskId: 'seed-development-accounts' });
    expect(succeeded[0]).toMatchObject({
      taskId: 'seed-development-accounts',
      outcome: 'succeeded'
    });
    // 独立系统任务没有触发请求。
    expect(started[0].triggerRequestId).toBeUndefined();
  });

  it('records task.failed with the structured error when the seed task blows up', async () => {
    // createUser 缺失：seed 任务必然失败。
    const brokenGitea = { validateToken: vi.fn(), createOrganizationRepo: vi.fn() };
    const app = buildApp({
      dbPath: path.join(tmpDir, 'broken.db'),
      giteaService: brokenGitea as never,
      repoOwner: 'esl-skills',
      autoSeed: true,
      logger: capture.logger
    });
    await flushTasks();
    await flushTasks();
    await app.close();

    const failed = recordsForEvent(capture, 'task.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      level: 50,
      outcome: 'failed',
      taskId: 'seed-development-accounts'
    });
    expect(failed[0].err).toBeDefined();
  });

  it('binds taskId and the triggering request id for an in-request task', async () => {
    const dbPath = path.join(tmpDir, 'org.db');
    const gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'eslroot', password: 'root-password' }
      ],
      orgs: []
    });
    const aliceToken = (await gitea.loginUser('alice', 'alice-password'))!;
    const app = buildApp({
      dbPath,
      giteaService: gitea as never,
      repoOwner: 'esl-skills',
      logger: capture.logger
    });

    // 先建一个组织，再由所有者成员删除它——删除是请求内的后台任务。
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: `token ${aliceToken}` },
      payload: { orgName: 'acme' }
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: { authorization: `token ${aliceToken}` },
      payload: { confirm: 'acme' }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const started = recordsForEvent(capture, 'task.started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      taskId: 'organization-deletion',
      triggerRequestId: expect.any(String)
    });
    expect(recordsForEvent(capture, 'task.succeeded')).toHaveLength(1);
  });
});
