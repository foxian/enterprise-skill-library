import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

describe('Skill User email settings', () => {
  let tmpDir: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let aliceToken: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-account-email-'));
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password', email: 'alice@example.com' },
        { username: 'bob', password: 'bob-password', email: 'bob@example.com' },
        { username: 'legacy', password: 'legacy-password' }
      ]
    });
    aliceToken = (await gitea.loginUser('alice', 'alice-password'))!;
    app = await buildApp({
      dbPath: path.join(tmpDir, 'test.db'),
      giteaService: gitea as any,
      repoOwner: 'esl-skills'
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const headers = () => ({ authorization: `token ${aliceToken}` });

  it('returns the current Skill User Email and pending-completion state', async () => {
    const profile = await app.inject({
      method: 'GET',
      url: '/api/account/profile',
      headers: headers()
    });

    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      emailPendingCompletion: false
    });
  });

  it('changes the current user email only with the correct password and enforces uniqueness', async () => {
    const missingPassword = await app.inject({
      method: 'PUT',
      url: '/api/account/email',
      headers: headers(),
      payload: { email: 'alice.new@example.com' }
    });
    expect(missingPassword.statusCode).toBe(400);

    const wrongPassword = await app.inject({
      method: 'PUT',
      url: '/api/account/email',
      headers: headers(),
      payload: { email: 'alice.new@example.com', currentPassword: 'wrong-password' }
    });
    expect(wrongPassword.statusCode).toBe(401);

    const duplicate = await app.inject({
      method: 'PUT',
      url: '/api/account/email',
      headers: headers(),
      payload: { email: 'bob@example.com', currentPassword: 'alice-password' }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('emailAlreadyTaken');

    const changed = await app.inject({
      method: 'PUT',
      url: '/api/account/email',
      headers: headers(),
      payload: { email: 'ALICE.NEW@example.com', currentPassword: 'alice-password' }
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({
      username: 'alice',
      email: 'alice.new@example.com',
      emailPendingCompletion: false
    });
    expect(await gitea.getUser('alice')).toMatchObject({ email: 'alice.new@example.com' });
  });

  it('lets a legacy user clear pending completion by setting a unique email', async () => {
    const legacyToken = (await gitea.loginUser('legacy', 'legacy-password'))!;
    const before = await app.inject({
      method: 'GET',
      url: '/api/account/profile',
      headers: { authorization: `token ${legacyToken}` }
    });
    expect(before.json()).toMatchObject({
      email: 'legacy@local.esl',
      emailPendingCompletion: true
    });

    const changed = await app.inject({
      method: 'PUT',
      url: '/api/account/email',
      headers: { authorization: `token ${legacyToken}` },
      payload: { email: 'legacy@example.com', currentPassword: 'legacy-password' }
    });

    expect(changed.json()).toMatchObject({
      email: 'legacy@example.com',
      emailPendingCompletion: false
    });
  });
});
