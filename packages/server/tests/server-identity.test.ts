import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { initDatabase, ServerIdentityRepository } from '../src/db/database.js';

describe('ESL Server instance identity', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-server-identity-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createApp(databasePath = dbPath): FastifyInstance {
    return buildApp({
      dbPath: databasePath,
      giteaService: { validateToken: vi.fn(), createOrganizationRepo: vi.fn() } as any,
      repoOwner: 'esl-skills'
    });
  }

  it('exposes a stable anonymous instance ID without protected data', async () => {
    app = createApp();
    const first = await app.inject({ method: 'GET', url: '/api/public/server-identity' });
    const second = await app.inject({ method: 'GET', url: '/api/public/server-identity' });

    expect(first.statusCode).toBe(200);
    const payload = JSON.parse(first.body) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['instanceId', 'protocolVersion']);
    expect(payload.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(payload.protocolVersion).toBe(1);
    expect(JSON.parse(second.body).instanceId).toBe(payload.instanceId);
    expect(first.body).not.toContain('skills');
    expect(first.body).not.toContain('token');
  });

  it('keeps the same instance ID after restart and backup-style reopen', async () => {
    app = createApp();
    const first = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/public/server-identity' })).body
    ) as { instanceId: string };
    await app.close();
    app = undefined;

    // 同一数据库重新打开（等价于重启/从备份恢复到同一数据目录）。
    app = createApp();
    const second = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/public/server-identity' })).body
    ) as { instanceId: string };
    expect(second.instanceId).toBe(first.instanceId);
  });

  it('gives independently created deployments different instance IDs', () => {
    const dbA = initDatabase(path.join(tmpDir, 'a.db'));
    const dbB = initDatabase(path.join(tmpDir, 'b.db'));
    try {
      const a = new ServerIdentityRepository(dbA).get().instanceId;
      const b = new ServerIdentityRepository(dbB).get().instanceId;
      expect(a).not.toBe(b);
    } finally {
      dbA.close();
      dbB.close();
    }
  });
});
