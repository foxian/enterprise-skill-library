import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

describe('Skill Source Upload API', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let gitea: {
    validateToken: ReturnType<typeof vi.fn>;
    createOrganizationRepo: ReturnType<typeof vi.fn>;
    addCollaborator: ReturnType<typeof vi.fn>;
    deleteRepo: ReturnType<typeof vi.fn>;
    createReleaseTag: ReturnType<typeof vi.fn>;
    getReleaseTag: ReturnType<typeof vi.fn>;
    readSourceTree: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-upload-api-'));
    gitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'platform-ai_alice' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' }),
      addCollaborator: vi.fn().mockResolvedValue(undefined),
      deleteRepo: vi.fn().mockResolvedValue(undefined),
      createReleaseTag: vi.fn().mockResolvedValue(undefined),
      getReleaseTag: vi.fn().mockResolvedValue(null),
      readSourceTree: vi.fn().mockResolvedValue({})
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

  const upload = (name = 'reviewer', description = 'Review code') =>
    app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name, description }
    });

  const releaseManifest = {
    schemaVersion: 2,
    version: '0.1.0',
    license: 'MIT',
    keywords: [],
    compatibility: {},
    dependencies: {}
  };

  it('resumes an interrupted first upload instead of rejecting a duplicate', async () => {
    const first = await upload();
    expect(first.statusCode).toBe(201);

    const retry = await upload();
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      name: '@platform-ai/reviewer',
      skillId: first.json().skillId,
      cloneUrl: expect.stringContaining('/git/platform-ai/reviewer.git')
    });
    expect(gitea.createOrganizationRepo).toHaveBeenCalledTimes(1);
  });

  it('still rejects re-upload of a published skill', async () => {
    gitea.readSourceTree = vi.fn().mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify(releaseManifest)
    });
    await upload();
    await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: { version: '1.0.0', sourceCommit: 'abc123', releaseManifest }
    });

    const retry = await upload();
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error).toContain('already exists');
  });

  it('rejects re-upload by a different creator', async () => {
    await upload();
    gitea.validateToken.mockResolvedValue({ username: 'platform-ai_bob' });

    const retry = await upload();
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error).toContain('already exists');
  });

  it('rejects an upload from an account without an organization scope', async () => {
    gitea.validateToken.mockResolvedValue({ username: 'eslroot' });

    const response = await upload();
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain('organization-scoped account');
    expect(gitea.createOrganizationRepo).not.toHaveBeenCalled();
  });

  it('rejects an upload when the caller tenant organization is not active', async () => {
    const db = initDatabase(path.join(tmpDir, 'test.db'));
    new TenantOrganizationRepository(db).create({ orgName: 'frozen', status: 'pending' });
    db.close();
    gitea.validateToken.mockResolvedValue({ username: 'frozen_bob' });

    const response = await upload();
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain('Tenant organization frozen is not active');
    expect(gitea.createOrganizationRepo).not.toHaveBeenCalled();
  });

  it('deletes the orphaned repository when provisioning fails after creation', async () => {
    gitea.addCollaborator.mockRejectedValue(new Error('collaborator failed'));

    const response = await upload();
    expect(response.statusCode).toBe(500);
    expect(gitea.deleteRepo).toHaveBeenCalledWith('platform-ai', 'reviewer');
  });

  it('accepts publish-sized request bodies instead of the 1MB Fastify default', async () => {
    // Publish sends the full source tree in the request body; a 2MB body must
    // reach route handling (401 auth) rather than being rejected as 413.
    const bigDescription = 'x'.repeat(2 * 1024 * 1024);
    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      payload: { name: 'big-skill', description: bigDescription }
    });

    expect(response.statusCode).not.toBe(413);
    expect(response.statusCode).toBe(401);
  });
});
