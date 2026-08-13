import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, saveConfig } from '@esl/core';
import {
  executeBootstrapStatus,
  executeCreateUser,
  executeDisableUser,
  executeIssueUserToken,
  executeChangePassword
} from '../src/commands/admin.js';

describe('esl admin', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-admin-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('checks bootstrap readiness from the saved registry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ready: true, adminUser: 'admin' })
    });

    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        registry: 'http://skills.company.com/api',
        gitBase: null,
        token: null,
        username: null,
        tools: []
      },
      { homeDir }
    );

    const result = await executeBootstrapStatus({ homeDir, customFetch: mockFetch as any });

    expect(result.ready).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/admin/bootstrap/status');
  });

  it('creates a user with the saved admin token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice', disabled: false })
    });

    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        registry: 'http://skills.company.com/api',
        gitBase: 'http://skills.company.com/git',
        token: 'bootstrap-token',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );

    const result = await executeCreateUser('alice', { homeDir, customFetch: mockFetch as any });

    expect(result.username).toBe('alice');
    expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/admin/users', {
      method: 'POST',
      headers: {
        Authorization: 'token bootstrap-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'alice' })
    });
  });

  it('issues a token for an existing user', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'issued-token' })
    });

    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        registry: 'http://skills.company.com/api',
        gitBase: 'http://skills.company.com/git',
        token: 'bootstrap-token',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );

    const token = await executeIssueUserToken('alice', { homeDir, customFetch: mockFetch as any });

    expect(token).toBe('issued-token');
    expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/admin/users/alice/tokens', {
      method: 'POST',
      headers: {
        Authorization: 'token bootstrap-token',
        'Content-Type': 'application/json'
      }
    });
  });

  it('disables a user with the saved admin token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });

    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        registry: 'http://skills.company.com/api',
        gitBase: 'http://skills.company.com/git',
        token: 'bootstrap-token',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );

    await executeDisableUser('alice', { homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/admin/users/alice/disable', {
      method: 'POST',
      headers: {
        Authorization: 'token bootstrap-token'
      }
    });
  });

  it('changes the current administrator password', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });

    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        registry: 'http://skills.company.com/api',
        gitBase: 'http://skills.company.com/git',
        token: 'bootstrap-token',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );

    await executeChangePassword({ homeDir, password: 'new-password', customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/admin/password', {
      method: 'POST',
      headers: {
        Authorization: 'token bootstrap-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: 'new-password' })
    });
  });
});
