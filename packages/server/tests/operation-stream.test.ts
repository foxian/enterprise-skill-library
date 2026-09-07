import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, OperationRepository, OrgApplicationRepository } from '../src/db/database.js';
import { OperationEventBus } from '../src/services/operation-events.js';
import { encryptApplicationSecret } from '../src/services/application-secret.js';

const ENCRYPTION_KEY = 'a'.repeat(64);

function mockGiteaService() {
  return {
    adminUsername: 'eslroot',
    validateToken: vi.fn().mockImplementation(async (token: string) => {
      if (token === 'alice-token') return { username: 'alice' };
      if (token === 'consumer-token') return { username: 'consumer' };
      if (token === 'acme-admin-token') return { username: 'acme_admin' };
      if (token === 'eslroot-token') return { username: 'eslroot' };
      return null;
    })
  };
}

interface EventCollector {
  waitFor: (predicate: (event: any) => boolean, timeoutMs?: number) => Promise<any>;
}

// 读取 SSE 响应体,把 data: 事件累积起来;waitFor 轮询直到匹配一个事件。
// signal 用于 AbortController 取消流;取消后读循环捕获 AbortError 正常退出。
function createEventCollector(response: Response): EventCollector {
  const events: any[] = [];
  void (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator: number;
        while ((separator = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine) {
            events.push(JSON.parse(dataLine.slice(6)));
          }
        }
      }
    } catch {
      // 流被取消或连接断开:收集到此为止
    }
  })();
  return {
    async waitFor(predicate, timeoutMs = 3_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = events.find(predicate);
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for SSE event');
    }
  };
}

describe('Operation SSE stream', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-ops-stream-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    // Windows 上 SQLite 连接关闭后文件句柄释放有延迟,rmSync 需要重试
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  it('rejects anonymous requests with 403', async () => {
    app = buildApp({ dbPath, giteaService: mockGiteaService() as any, repoOwner: 'esl-skills' });
    const db = initDatabase(dbPath);
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'stream.anon',
      kind: 'skill.create',
      payload: { username: 'alice' }
    });
    const res = await app.inject({ method: 'GET', url: `/api/operations/${operation.id}/stream` });
    expect(res.statusCode).toBe(403);
    db.close();
  });

  it('rejects requests for a nonexistent operation with 404', async () => {
    app = buildApp({ dbPath, giteaService: mockGiteaService() as any, repoOwner: 'esl-skills' });
    const res = await app.inject({ method: 'GET', url: '/api/operations/424242/stream' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-owner user with 403', async () => {
    app = buildApp({ dbPath, giteaService: mockGiteaService() as any, repoOwner: 'esl-skills' });
    const db = initDatabase(dbPath);
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'stream.foreign',
      kind: 'skill.create',
      payload: { username: 'alice' }
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/operations/${operation.id}/stream`,
      headers: { authorization: 'token consumer-token' }
    });
    expect(res.statusCode).toBe(403);
    db.close();
  });

  it('rejects an organization applicant with a wrong password with 403', async () => {
    app = buildApp({
      dbPath,
      giteaService: mockGiteaService() as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: ENCRYPTION_KEY
    });
    const db = initDatabase(dbPath);
    const orgRepo = new OrgApplicationRepository(db);
    orgRepo.createApplication({
      orgName: 'acme',
      adminDisplayName: 'admin',
      encryptedPassword: encryptApplicationSecret('real-password', ENCRYPTION_KEY)
    });
    const application = orgRepo.getApplication('acme')!;
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'stream.acme.wrong',
      kind: 'organization.provision',
      payload: { orgName: 'acme', applicationId: application.id }
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/operations/${operation.id}/stream`,
      headers: { 'x-org-password': 'wrong-password' }
    });
    expect(res.statusCode).toBe(403);
    db.close();
  });

  it('allows the platform administrator (Gitea admin) to subscribe to an organization provision stream', async () => {
    app = buildApp({
      dbPath,
      giteaService: mockGiteaService() as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: ENCRYPTION_KEY
    });
    await app.listen({ port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const db = initDatabase(dbPath);
    const orgRepo = new OrgApplicationRepository(db);
    orgRepo.createApplication({
      orgName: 'acme',
      adminDisplayName: 'system',
      encryptedPassword: encryptApplicationSecret('pw', ENCRYPTION_KEY)
    });
    const application = orgRepo.getApplication('acme')!;
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'stream.admin.provision',
      kind: 'organization.provision',
      payload: { orgName: 'acme', applicationId: application.id }
    });

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/operations/${operation.id}/stream`, {
      headers: { authorization: 'token eslroot-token' },
      signal: controller.signal
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const collector = createEventCollector(response);
    try {
      const initial = await collector.waitFor((event) => event.status === 'pending');
      expect(initial.operationId).toBe(operation.id);
    } finally {
      controller.abort();
    }
    db.close();
  });

  it('streams the current status and publishes settle events', async () => {
    const bus = new OperationEventBus();
    app = buildApp({
      dbPath,
      giteaService: mockGiteaService() as any,
      repoOwner: 'esl-skills',
      operationEventBus: bus
    });
    await app.listen({ port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const db = initDatabase(dbPath);
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'stream.ok',
      kind: 'skill.create',
      payload: { username: 'alice' }
    });

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/operations/${operation.id}/stream`, {
      headers: { authorization: 'token alice-token' },
      signal: controller.signal
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const collector = createEventCollector(response);
    try {
      const initial = await collector.waitFor((event) => event.status === 'pending');
      expect(initial.operationId).toBe(operation.id);

      bus.publish({ ...operation, status: 'succeeded', error: null });
      const settled = await collector.waitFor((event) => event.status === 'succeeded');
      expect(settled.operationId).toBe(operation.id);
    } finally {
      controller.abort();
      await app.close();
      app = undefined;
      db.close();
    }
  });

  it('allows an organization administrator to subscribe to a member operation', async () => {
    app = buildApp({ dbPath, giteaService: mockGiteaService() as any, repoOwner: 'esl-skills' });
    await app.listen({ port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const db = initDatabase(dbPath);
    // member.create 的 payload 目标是新成员(acme_bob),发起者是组织管理员(acme_admin)
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'stream.member.create',
      kind: 'member.create',
      payload: { orgName: 'acme', username: 'acme_bob' }
    });

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/operations/${operation.id}/stream`, {
      headers: { authorization: 'token acme-admin-token' },
      signal: controller.signal
    });
    expect(response.status).toBe(200);
    const collector = createEventCollector(response);
    try {
      const initial = await collector.waitFor((event) => event.operationId === operation.id);
      expect(initial.status).toBe('pending');
    } finally {
      controller.abort();
      await app.close();
      app = undefined;
      db.close();
    }
  });

  it('allows an organization applicant to subscribe with the initial password', async () => {
    app = buildApp({
      dbPath,
      giteaService: mockGiteaService() as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: ENCRYPTION_KEY
    });
    await app.listen({ port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const db = initDatabase(dbPath);
    const orgRepo = new OrgApplicationRepository(db);
    orgRepo.createApplication({
      orgName: 'acme',
      adminDisplayName: 'admin',
      encryptedPassword: encryptApplicationSecret('secret-password', ENCRYPTION_KEY)
    });
    const application = orgRepo.getApplication('acme')!;
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'stream.acme.ok',
      kind: 'organization.provision',
      payload: { orgName: 'acme', applicationId: application.id }
    });

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/operations/${operation.id}/stream`, {
      headers: { 'x-org-password': 'secret-password' },
      signal: controller.signal
    });
    expect(response.status).toBe(200);
    const collector = createEventCollector(response);
    try {
      const initial = await collector.waitFor((event) => event.operationId === operation.id);
      expect(initial.status).toBe('pending');
    } finally {
      controller.abort();
      await app.close();
      app = undefined;
      db.close();
    }
  });
});
