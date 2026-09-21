import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository, UserRegistrationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 用户自助注册（ADR-0032 / #52）：全局账号、扁平命名池查重（用户 / 组织 /
// 保留名 / 待审申请）、registration_mode = open | approval。
describe('user self-registration', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  function buildDb(): void {
    const db = initDatabase(dbPath);
    // 组织名占用扁平命名池的一个名字
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    db.close();
  }

  async function login(username: string, password: string): Promise<number> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password }
    });
    return res.statusCode;
  }

  async function register(
    username: string,
    password = 'a-valid-password',
    email = `${username}@example.com`
  ): Promise<{ statusCode: number; json: () => any }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password, email }
    });
    return { statusCode: res.statusCode, json: () => res.json() };
  }

  describe('open mode (default)', () => {
    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-register-'));
      dbPath = path.join(tmpDir, 'test.db');
      gitea = createGlobalGitea({
        users: [{ username: 'existing', password: 'whatever-pass' }],
        orgs: [{ name: 'acme', teams: [] }]
      });
      buildDb();
      app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    });

    afterEach(async () => {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('registers a new account that can log in immediately', async () => {
      const res = await register('dave');

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ username: 'dave', status: 'registered' });
      expect(await login('dave', 'a-valid-password')).toBe(200);
    });

    it('rejects a username that collides with an existing user, organization, or reserved name', async () => {
      const user = await register('existing');
      expect(user.statusCode).toBe(409);
      expect(user.json().message).toContain('existing');

      const org = await register('acme');
      expect(org.statusCode).toBe(409);
      expect(org.json().message).toContain('acme');

      const reserved = await register('system');
      expect(reserved.statusCode).toBe(400);
      expect(reserved.json().message).toContain('reserved');
    });

    it('rejects weak passwords and malformed usernames', async () => {
      const weak = await register('dave', 'short');
      expect(weak.statusCode).toBe(400);

      const bad = await register('Bad Name');
      expect(bad.statusCode).toBe(400);
    });

    it('requires a Skill User Email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'dave', password: 'a-valid-password' }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('emailIsRequired');
    });

    it('stores the provided Skill User Email in the Git Backend', async () => {
      const res = await register('dave', 'a-valid-password', 'dave@example.com');

      expect(res.statusCode).toBe(201);
      expect(await gitea.getUser('dave')).toMatchObject({ email: 'dave@example.com' });
    });

    it('rejects a Skill User Email already used by another account', async () => {
      await register('dave', 'a-valid-password', 'shared@example.com');

      const duplicate = await register('erin', 'a-valid-password', 'SHARED@example.com');

      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().code).toBe('emailAlreadyTaken');
    });
  });

  describe('approval mode', () => {
    let superToken: string;

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-register-approval-'));
      dbPath = path.join(tmpDir, 'test.db');
      gitea = createGlobalGitea({ users: [{ username: 'eslroot', password: 'root-password' }], orgs: [] });
      superToken = (await gitea.loginUser('eslroot', 'root-password'))!;
      buildDb();
      const db = initDatabase(dbPath);
      app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
      db.close();
      const settings = await app.inject({
        method: 'PUT',
        url: '/api/admin/orgs/settings',
        headers: superHeaders(),
        payload: { registrationMode: 'approval' }
      });
      expect(settings.statusCode).toBe(200);
    });

    afterEach(async () => {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function superHeaders(): { authorization: string } {
      return { authorization: `token ${superToken}` };
    }

    it('registers into pending state; login stays rejected until approved', async () => {
      const res = await register('erin');
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ username: 'erin', status: 'pending' });
      expect(res.json().registrationId).toBeGreaterThan(0);

      // 待审批账号不可登录（Gitea 侧禁用）
      expect(await login('erin', 'a-valid-password')).toBe(401);

      const approve = await app.inject({
        method: 'POST',
        url: '/api/admin/registrations/1/approve',
        headers: superHeaders()
      });
      expect(approve.statusCode).toBe(200);
      expect(await login('erin', 'a-valid-password')).toBe(200);
    });

    it('rejecting a pending registration deletes the account and releases the name', async () => {
      await register('frank');

      const reject = await app.inject({
        method: 'POST',
        url: '/api/admin/registrations/1/reject',
        headers: superHeaders()
      });
      expect(reject.statusCode).toBe(200);
      expect(gitea.deleteUser).toHaveBeenCalledWith('frank');
      expect(await login('frank', 'a-valid-password')).toBe(401);

      // 名字已释放：可以重新注册
      const again = await register('frank');
      expect(again.statusCode).toBe(202);
    });

    it('rejects a username with a same-name pending registration at submission time', async () => {
      await register('grace');
      const duplicate = await register('grace');

      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().message).toContain('pending');
    });

    it('rejects a Skill User Email already reserved by a pending registration', async () => {
      await register('grace', 'a-valid-password', 'shared@example.com');

      const duplicate = await register('henry', 'a-valid-password', 'shared@example.com');

      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().code).toBe('emailHasPendingRegistration');
    });

    it('lists pending registrations for the super administrator', async () => {
      await register('henry');
      const list = await app.inject({
        method: 'GET',
        url: '/api/admin/registrations?status=pending',
        headers: superHeaders()
      });

      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: expect.any(Number),
          username: 'henry',
          email: 'henry@example.com',
          status: 'pending'
        })
      ]);
    });
  });
});
