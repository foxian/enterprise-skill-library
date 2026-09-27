import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, PlatformSettingsRepository } from '../src/db/database.js';
import type { MailMessage, Mailer } from '../src/services/mailer.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

describe('email actions', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let messages: MailMessage[];
  let mailer: Mailer;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-email-actions-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'eslroot', password: 'root-password', email: 'eslroot@example.com' },
        { username: 'alice', password: 'alice-password', email: 'alice@example.com' },
        { username: 'disabled', password: 'disabled-password', email: 'disabled@example.com' },
        { username: 'legacy', password: 'legacy-password' }
      ]
    });
    messages = [];
    mailer = {
      isConfigured: () => true,
      send: async (message) => {
        messages.push(message);
      }
    };
    const db = initDatabase(dbPath);
    const settings = new PlatformSettingsRepository(db);
    settings.setSetting('email_verification', 'on');
    db.close();
    app = await buildApp({
      dbPath,
      giteaService: gitea as any,
      repoOwner: 'esl-skills',
      mailer,
      emailActionSecret: 'test-email-action-secret'
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function tokenFromLastMessage(): string {
    const text = messages.at(-1)?.text ?? '';
    const match = text.match(/[?&]token=([^\s]+)$/);
    expect(match).not.toBeNull();
    return decodeURIComponent(match![1]);
  }

  it('holds open registration until the email link is verified', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'localhost:3000' },
      payload: { username: 'bob', password: 'bob-password', email: 'bob@example.com' }
    });

    expect(registration.statusCode).toBe(202);
    expect(registration.json()).toEqual({ status: 'pending_email_verification', username: 'bob' });
    expect(await gitea.getUser('bob')).toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to: 'bob@example.com' });

    const verification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: tokenFromLastMessage() }
    });
    expect(verification.statusCode).toBe(200);
    expect(verification.json()).toMatchObject({ status: 'verified', username: 'bob' });
    expect(await gitea.getUser('bob')).toMatchObject({ email: 'bob@example.com' });

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: tokenFromLastMessage() }
    });
    expect(reused.statusCode).toBe(400);
  });

  it('reserves a pending registration username until verification', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'localhost:3000' },
      payload: { username: 'reserved', password: 'reserved-password', email: 'reserved@example.com' }
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'reserved', password: 'other-password', email: 'other@example.com' }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('usernameHasPendingRegistration');
    expect(messages).toHaveLength(1);
    expect(await gitea.getUser('reserved')).toBeNull();

    const adminToken = (await gitea.loginUser('eslroot', 'root-password'))!;
    const provisioned = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `token ${adminToken}` },
      payload: { username: 'reserved', password: 'admin-password', email: 'admin-reserved@example.com' }
    });
    expect(provisioned.statusCode).toBe(409);
    expect(provisioned.json().code).toBe('usernameHasPendingRegistration');
  });

  it('keeps the old email active until a user email change is verified', async () => {
    const token = (await gitea.loginUser('alice', 'alice-password'))!;
    const changed = await app.inject({
      method: 'PUT',
      url: '/api/account/email',
      headers: { authorization: `token ${token}` },
      payload: { email: 'alice.new@example.com', currentPassword: 'alice-password' }
    });

    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      username: 'alice',
      email: 'alice@example.com',
      emailPendingVerification: true
    });
    expect(await gitea.getUser('alice')).toMatchObject({ email: 'alice@example.com' });

    const pendingProfile = await app.inject({
      method: 'GET',
      url: '/api/account/profile',
      headers: { authorization: `token ${token}` }
    });
    expect(pendingProfile.json()).toMatchObject({
      email: 'alice@example.com',
      emailPendingVerification: true
    });

    const verification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: tokenFromLastMessage() }
    });
    expect(verification.statusCode).toBe(200);
    expect(await gitea.getUser('alice')).toMatchObject({ email: 'alice.new@example.com' });
  });

  it('resets a Skill User password by email and invalidates existing sessions', async () => {
    const oldToken = (await gitea.loginUser('alice', 'alice-password'))!;
    const requested = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      headers: { host: 'localhost:3000' },
      payload: { username: 'alice' }
    });
    expect(requested.statusCode).toBe(202);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset',
      payload: { token: tokenFromLastMessage(), newPassword: 'alice-new-password' }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ passwordReset: true });
    expect(gitea.__state.mustChangePasswords.get('alice')).toBe(false);
    expect(await gitea.validateToken(oldToken)).toBeNull();
    expect(await gitea.loginUser('alice', 'alice-new-password')).toBeTruthy();

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset',
      payload: { token: tokenFromLastMessage(), newPassword: 'alice-other-password' }
    });
    expect(reused.statusCode).toBe(400);
  });

  it('keeps approval registration independent from email verification', async () => {
    const db = initDatabase(dbPath);
    new PlatformSettingsRepository(db).setSetting('registration_mode', 'approval');
    db.close();

    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'pending', password: 'pending-password', email: 'pending@example.com' }
    });

    expect(registration.statusCode).toBe(202);
    expect(registration.json().status).toBe('pending');
    expect(messages).toHaveLength(0);
    expect(await gitea.getUser('pending')).toBeTruthy();
  });

  it('does not reveal whether an account can receive a reset email', async () => {
    const before = messages.length;
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { username: 'unknown' }
    });
    const administrator = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { username: 'eslroot' }
    });

    expect(unknown.statusCode).toBe(202);
    expect(administrator.statusCode).toBe(202);
    expect(unknown.json()).toEqual(administrator.json());
    expect(messages).toHaveLength(before);
  });

  it('does not email password reset links to disabled or incomplete accounts', async () => {
    await gitea.disableUser('disabled');
    const before = messages.length;
    const disabledAccount = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { username: 'disabled' }
    });
    const incomplete = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { username: 'legacy' }
    });

    expect(disabledAccount.statusCode).toBe(202);
    expect(incomplete.statusCode).toBe(202);
    expect(disabledAccount.json()).toEqual(incomplete.json());
    expect(messages).toHaveLength(before);
  });

  it('invalidates the previous registration verification link on resend', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'localhost:3000' },
      payload: { username: 'bob', password: 'bob-password', email: 'bob@example.com' }
    });
    expect(registration.statusCode).toBe(202);
    const originalToken = tokenFromLastMessage();

    const resend = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email/resend',
      headers: { host: 'localhost:3000' },
      payload: { username: 'bob', purpose: 'register' }
    });
    expect(resend.statusCode).toBe(202);

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: originalToken }
    });
    expect(reused.statusCode).toBe(400);

    const verification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: tokenFromLastMessage() }
    });
    expect(verification.statusCode).toBe(200);
    expect(await gitea.getUser('bob')).toMatchObject({ email: 'bob@example.com' });
  });

  it('does not let strangers invalidate a pending email change', async () => {
    const token = (await gitea.loginUser('alice', 'alice-password'))!;
    const changed = await app.inject({
      method: 'PUT',
      url: '/api/account/email',
      headers: { authorization: `token ${token}`, host: 'localhost:3000' },
      payload: { email: 'alice.new@example.com', currentPassword: 'alice-password' }
    });
    expect(changed.statusCode).toBe(200);
    const originalToken = tokenFromLastMessage();

    const anonymousResend = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email/resend',
      headers: { host: 'localhost:3000' },
      payload: { username: 'alice', purpose: 'email_change' }
    });
    expect(anonymousResend.statusCode).toBe(401);

    const ownerResend = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email/resend',
      headers: { authorization: `token ${token}`, host: 'localhost:3000' },
      payload: { purpose: 'email_change' }
    });
    expect(ownerResend.statusCode).toBe(202);

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: originalToken }
    });
    expect(reused.statusCode).toBe(400);

    const verification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: tokenFromLastMessage() }
    });
    expect(verification.statusCode).toBe(200);
    expect(await gitea.getUser('alice')).toMatchObject({ email: 'alice.new@example.com' });
  });

  it('consumes a registration verification token when the username is taken', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'localhost:3000' },
      payload: { username: 'bob', password: 'bob-password', email: 'bob@example.com' }
    });
    expect(registration.statusCode).toBe(202);
    const token = tokenFromLastMessage();
    await gitea.createUser('bob', 'other-password', { email: 'other-bob@example.com' });

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token }
    });
    expect(first.statusCode).toBe(409);

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token }
    });
    expect(reused.statusCode).toBe(400);

    const retry = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'localhost:3000' },
      payload: { username: 'carol', password: 'carol-password', email: 'bob@example.com' }
    });
    expect(retry.statusCode).toBe(202);
  });

  it('releases an expired pending registration so the username can be reused', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'localhost:3000' },
      payload: { username: 'bob', password: 'bob-password', email: 'bob@example.com' }
    });
    expect(registration.statusCode).toBe(202);

    const db = initDatabase(dbPath);
    db.prepare('UPDATE email_actions SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
    db.close();

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'localhost:3000' },
      payload: { username: 'bob', password: 'other-password', email: 'other-bob@example.com' }
    });
    expect(reused.statusCode).toBe(202);
    expect(await gitea.getUser('bob')).toBeNull();
  });
});
