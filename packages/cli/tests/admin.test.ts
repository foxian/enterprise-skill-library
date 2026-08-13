import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';
import {
  executeBootstrapStatus,
  executeCreateUser,
  executeDisableUser,
  executeIssueUserToken,
  executeGiteaPasswordChange
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
        registry: 'http://skills.company.com/api',
        gitBase: 'http://skills.company.com/git',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );
    await saveCredentials({ token: adminToken }, { homeDir });
  }

  it('checks bootstrap readiness from the saved registry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ready: true, gitea: 'ready', adminToken: 'ready', repoOwner: 'ready' })
    });

    await initializeLocalStore({ homeDir });
    await saveConfig({ registry: 'http://skills.company.com/api' }, { homeDir });

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

  it('changes the Gitea administrator password from a file', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await seedAdmin('bootstrap-token');
    const passwordFile = path.join(homeDir, 'new-pw.txt');
    fs.writeFileSync(passwordFile, 'new-password');

    await executeGiteaPasswordChange({ homeDir, passwordFile, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/admin/gitea/password',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'token bootstrap-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: 'new-password' })
      })
    );
  });

  it('fails fast when changing password with --no-input and no file', async () => {
    const mockFetch = vi.fn();
    await seedAdmin('bootstrap-token');

    await expect(
      executeGiteaPasswordChange({ homeDir, noInput: true, customFetch: mockFetch as any })
    ).rejects.toThrow('pass --password-file');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
