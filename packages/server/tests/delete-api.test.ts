import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Skill Delete API', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let gitea: {
    validateToken: ReturnType<typeof vi.fn>;
    validateAdminUserToken: ReturnType<typeof vi.fn>;
    createOrganizationRepo: ReturnType<typeof vi.fn>;
    deleteRepo: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-delete-'));
    gitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      validateAdminUserToken: vi.fn().mockResolvedValue(null),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' }),
      deleteRepo: vi.fn().mockResolvedValue(undefined)
    };
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
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    return (info.json() as { skillId: string }).skillId;
  }

  it('rejects deletion by a non-administrator', async () => {
    await uploadReviewer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/delete',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(403);
  });

  it('completely deletes the skill, its repository and packages for an administrator', async () => {
    const skillId = await uploadReviewer();
    fs.mkdirSync(path.join(tmpDir, 'packages', skillId, '1.0.0'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'packages', skillId, '1.0.0', 'pkg.json'), '{}');

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/delete',
      headers: { authorization: 'token bootstrap-token' },
      payload: { confirm: '@platform-ai/reviewer' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deleted: true, name: '@platform-ai/reviewer', skillId });
    expect(gitea.deleteRepo).toHaveBeenCalledWith('platform-ai', 'reviewer');
    expect(fs.existsSync(path.join(tmpDir, 'packages', skillId))).toBe(false);

    const after = await app.inject({ method: 'GET', url: '/api/skills/@platform-ai/reviewer' });
    expect(after.statusCode).toBe(404);
  });

  it('rejects deletion without a confirm field matching the skill identity', async () => {
    await uploadReviewer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/delete',
      headers: { authorization: 'token bootstrap-token' },
      payload: { confirm: 'some-other-skill' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('confirm');
    const stillThere = await app.inject({
      method: 'GET',
      url: '/api/skills/@platform-ai/reviewer',
      headers: { authorization: 'token alice-token' }
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it('returns 404 when the skill does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/missing/delete',
      headers: { authorization: 'token bootstrap-token' }
    });

    expect(response.statusCode).toBe(404);
  });
});
