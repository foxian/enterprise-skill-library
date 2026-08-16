import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';
import {
  executeBootstrapStatus,
  executeChangeOwnPassword,
  executeCreateUser,
  executeDisableUser,
  executeIssueUserToken,
  executeSetUserPassword,
  executeAdministratorAccountPasswordChange
} from '../src/commands/admin.js';

describe('esl admin', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-admin-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  async function seedAdmin(adminToken: string): Promise<void> {
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        server: 'http://skills.company.com',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );
    await saveCredentials({ token: adminToken, loginAt: new Date().toISOString() }, { homeDir });
  }

  it('checks bootstrap readiness from the saved ESL Server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ready: true, gitea: 'ready', adminToken: 'ready', repoOwner: 'ready' })
    });

    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://skills.company.com' }, { homeDir });

    const result = await executeBootstrapStatus({ homeDir, customFetch: mockFetch as any });

    expect(result.ready).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/bootstrap/status',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('creates a user with the saved admin token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice', disabled: false })
    });
    await seedAdmin('bootstrap-token');

    const result = await executeCreateUser('alice', { homeDir, customFetch: mockFetch as any });

    expect(result.username).toBe('alice');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/users',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'token bootstrap-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: 'alice' })
      })
    );
  });

  it('surfaces the generated initial password returned by the server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice', disabled: false, password: 'generated-password' })
    });
    await seedAdmin('bootstrap-token');

    const result = await executeCreateUser('alice', { homeDir, customFetch: mockFetch as any });

    expect(result.password).toBe('generated-password');
  });

  it('passes a custom initial password from a password file when creating a user', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice', disabled: false })
    });
    await seedAdmin('bootstrap-token');
    const passwordFile = path.join(homeDir, 'initial-pw.txt');
    fs.writeFileSync(passwordFile, 'custom-password');

    const result = await executeCreateUser('alice', { homeDir, passwordFile, customFetch: mockFetch as any });

    expect(result.password).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/users',
      expect.objectContaining({
        body: JSON.stringify({ username: 'alice', password: 'custom-password' })
      })
    );
  });

  it('rejects create with both --random and --password-file', async () => {
    const mockFetch = vi.fn();
    await seedAdmin('bootstrap-token');
    const passwordFile = path.join(homeDir, 'initial-pw.txt');
    fs.writeFileSync(passwordFile, 'custom-password');

    await expect(
      executeCreateUser('alice', { homeDir, passwordFile, random: true, customFetch: mockFetch as any })
    ).rejects.toThrow('mutually exclusive');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('issues a token for an existing user', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'issued-token' })
    });
    await seedAdmin('bootstrap-token');

    const token = await executeIssueUserToken('alice', { homeDir, customFetch: mockFetch as any });

    expect(token).toBe('issued-token');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/users/alice/tokens',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'token bootstrap-token'
        }
      })
    );
  });

  it('resets a user password with a generated one shown once', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice', password: 'generated-password' })
    });
    await seedAdmin('bootstrap-token');

    const result = await executeSetUserPassword('alice', { homeDir, customFetch: mockFetch as any });

    expect(result.password).toBe('generated-password');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/users/alice/password',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'token bootstrap-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      })
    );
  });

  it('passes a supplied password when resetting a user password', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice' })
    });
    await seedAdmin('bootstrap-token');
    const passwordFile = path.join(homeDir, 'reset-pw.txt');
    fs.writeFileSync(passwordFile, 'supplied-password');

    const result = await executeSetUserPassword('alice', {
      homeDir,
      passwordFile,
      customFetch: mockFetch as any
    });

    expect(result.password).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/users/alice/password',
      expect.objectContaining({
        body: JSON.stringify({ password: 'supplied-password' })
      })
    );
  });

  it('rejects resetting a user password with both --random and --password-file', async () => {
    const mockFetch = vi.fn();
    await seedAdmin('bootstrap-token');
    const passwordFile = path.join(homeDir, 'reset-pw.txt');
    fs.writeFileSync(passwordFile, 'supplied-password');

    await expect(
      executeSetUserPassword('alice', { homeDir, passwordFile, random: true, customFetch: mockFetch as any })
    ).rejects.toThrow('mutually exclusive');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('disables a user with the saved admin token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await seedAdmin('bootstrap-token');

    await executeDisableUser('alice', { homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/users/alice/disable',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'token bootstrap-token'
        }
      })
    );
  });

  it('changes the current user password with current and new passwords', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await seedAdmin('alice-token');
    const readPassword = vi
      .fn()
      .mockResolvedValueOnce('current-password')
      .mockResolvedValueOnce('new-password')
      .mockResolvedValueOnce('new-password');

    await executeChangeOwnPassword({ homeDir, readPassword, customFetch: mockFetch as any });

    expect(readPassword).toHaveBeenNthCalledWith(1, 'Current password: ');
    expect(readPassword).toHaveBeenNthCalledWith(2, 'New password: ');
    expect(readPassword).toHaveBeenNthCalledWith(3, 'Confirm new password: ');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/password',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'token alice-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ oldPassword: 'current-password', newPassword: 'new-password' })
      })
    );
  });

  it('rejects a self-service password change when the new passwords do not match', async () => {
    const mockFetch = vi.fn();
    await seedAdmin('alice-token');

    await expect(
      executeChangeOwnPassword({
        homeDir,
        readPassword: vi
          .fn()
          .mockResolvedValueOnce('current-password')
          .mockResolvedValueOnce('first-new')
          .mockResolvedValueOnce('second-new'),
        customFetch: mockFetch as any
      })
    ).rejects.toThrow('Passwords do not match');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('changes the ESL Administrator Account password from a file', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await seedAdmin('administrator-account-token');
    const passwordFile = path.join(homeDir, 'new-pw.txt');
    fs.writeFileSync(passwordFile, 'new-password');

    await executeAdministratorAccountPasswordChange({ homeDir, passwordFile, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/account/password',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'token administrator-account-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: 'new-password' })
      })
    );
  });

  it('changes the ESL Administrator Account password from stdin input', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await seedAdmin('administrator-account-token');

    await executeAdministratorAccountPasswordChange({
      homeDir,
      noInput: true,
      readInput: async () => 'stdin-password',
      customFetch: mockFetch as any
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/account/password',
      expect.objectContaining({
        body: JSON.stringify({ password: 'stdin-password' })
      })
    );
  });

  it('confirms the ESL Administrator Account password in interactive input', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await seedAdmin('administrator-account-token');
    const readPassword = vi.fn().mockResolvedValueOnce('new-password').mockResolvedValueOnce('new-password');

    await executeAdministratorAccountPasswordChange({
      homeDir,
      readPassword,
      customFetch: mockFetch as any
    });

    expect(readPassword).toHaveBeenNthCalledWith(1, 'New password: ');
    expect(readPassword).toHaveBeenNthCalledWith(2, 'Confirm new password: ');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/account/password',
      expect.objectContaining({
        body: JSON.stringify({ password: 'new-password' })
      })
    );
  });

  it('rejects mismatched interactive administrator account passwords', async () => {
    const mockFetch = vi.fn();
    await seedAdmin('administrator-account-token');

    await expect(
      executeAdministratorAccountPasswordChange({
        homeDir,
        readPassword: vi.fn().mockResolvedValueOnce('first-password').mockResolvedValueOnce('second-password'),
        customFetch: mockFetch as any
      })
    ).rejects.toThrow('Passwords do not match');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails fast when changing password with --no-input and no stdin or file', async () => {
    const mockFetch = vi.fn();
    await seedAdmin('administrator-account-token');

    await expect(
      executeAdministratorAccountPasswordChange({ homeDir, noInput: true, customFetch: mockFetch as any })
    ).rejects.toThrow('pass --password-file or pipe a password on stdin');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('prints the administrator account login guidance without raw JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: 'Administrator account login required to change its password' })
    });
    await seedAdmin('bootstrap-token');
    const passwordFile = path.join(homeDir, 'new-pw.txt');
    fs.writeFileSync(passwordFile, 'new-password');

    await expect(
      executeAdministratorAccountPasswordChange({ homeDir, passwordFile, customFetch: mockFetch as any })
    ).rejects.toThrow(
      'Failed to change administrator account password: Administrator account login required to change its password'
    );
  });

  it('rejects an admin command when the login is expired', async () => {
    const mockFetch = vi.fn();
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        server: 'http://skills.company.com',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );
    await saveCredentials(
      { token: 'bootstrap-token', loginAt: new Date(Date.now() - 31 * 24 * 3_600_000).toISOString() },
      { homeDir }
    );

    await expect(executeCreateUser('alice', { homeDir, customFetch: mockFetch as any })).rejects.toThrow(
      'Login expired; run esl login to re-authenticate'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
