import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

describe('Skill Delete API', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let gitea: {
    validateToken: ReturnType<typeof vi.fn>;
    validateAdminUserToken: ReturnType<typeof vi.fn>;
    createRepo: ReturnType<typeof vi.fn>;
    deleteRepo: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-delete-'));
    gitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      validateAdminUserToken: vi.fn().mockImplementation(async (token: string) =>
        token === 'eslroot-token' ? { username: 'eslroot' } : null
      ),
      createRepo: vi.fn().mockResolvedValue({ full_name: 'alice/reviewer' }),
      deleteRepo: vi.fn().mockResolvedValue(undefined)
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

  async function uploadReviewer(): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Review code' }
    });
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    return (info.json() as { skillId: string }).skillId;
  }

  async function archiveReviewer(): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/archive',
      headers: { authorization: 'token alice-token' }
    });
    if (response.statusCode !== 200) throw new Error(response.body);
  }

  it('rejects whole-skill deletion before the skill has been archived', async () => {
    await uploadReviewer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/delete',
      headers: { authorization: 'token eslroot-token' },
      payload: { confirm: '@alice/reviewer', reason: '治理清理' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('archived');
  });

  it('rejects deletion without a reason', async () => {
    await uploadReviewer();
    await archiveReviewer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/delete',
      headers: { authorization: 'token eslroot-token' },
      payload: { confirm: '@alice/reviewer' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('reason');
  });

  it('completely deletes an archived personal skill for its creator and writes an audit', async () => {
    const skillId = await uploadReviewer();
    await archiveReviewer();
    fs.mkdirSync(path.join(tmpDir, 'packages', skillId, '1.0.0'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'packages', skillId, '1.0.0', 'pkg.json'), '{}');

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '@alice/reviewer', reason: '治理清理' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deleted: true, name: '@alice/reviewer', skillId });
    expect(gitea.deleteRepo).toHaveBeenCalledWith('alice', 'reviewer');
    expect(fs.existsSync(path.join(tmpDir, 'packages', skillId))).toBe(false);
    const after = await app.inject({ method: 'GET', url: '/api/skills/@alice/reviewer' });
    expect(after.statusCode).toBe(404);
  });

  it('marks deletion failed and allows retry when Git deletion fails', async () => {
    await uploadReviewer();
    await archiveReviewer();
    gitea.deleteRepo.mockRejectedValueOnce(new Error('Gitea unavailable'));

    const failed = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '@alice/reviewer', reason: '治理清理' }
    });
    expect(failed.statusCode).toBe(409);

    const context = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer/permissions',
      headers: { authorization: 'token alice-token' }
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().skill).toMatchObject({ status: 'delete_failed', everPublished: false });

    const retried = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/delete',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: '@alice/reviewer', reason: '治理清理' }
    });
    expect(retried.statusCode).toBe(200);
    expect(gitea.deleteRepo).toHaveBeenCalledTimes(2);
  });

  it('restores an unpublished personal skill to active-unreleased for its creator', async () => {
    await uploadReviewer();
    await archiveReviewer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/restore',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'active-unreleased' });
  });

  it('rejects deletion without a confirm field matching the skill identity', async () => {
    await uploadReviewer();
    await archiveReviewer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/delete',
      headers: { authorization: 'token eslroot-token' },
      payload: { confirm: 'some-other-skill', reason: '治理清理' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('confirm');
    const stillThere = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it('returns 404 when the skill does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/missing/delete',
      headers: { authorization: 'token eslroot-token' },
      payload: { confirm: '@alice/missing', reason: '治理清理' }
    });

    expect(response.statusCode).toBe(404);
  });
});

