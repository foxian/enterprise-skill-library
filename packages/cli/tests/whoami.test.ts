import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, loadConfig, saveConfig, saveCredentials } from '@esl/core';
import { executeWhoami, formatWhoami } from '../src/commands/whoami.js';

describe('esl whoami', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-whoami-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  async function seedStore(overrides: {
    username?: string | null;
    email?: string | null;
    server?: string | null;
    token?: string | null;
    loginAt?: string | null;
  } = {}): Promise<void> {
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        server: overrides.server ?? 'http://localhost:3000',
        username: overrides.username ?? 'alice',
        email: overrides.email ?? null,
        tools: []
      },
      { homeDir }
    );
    await saveCredentials(
      {
        token: overrides.token ?? 'some-token',
        loginAt: overrides.loginAt ?? new Date().toISOString()
      },
      { homeDir }
    );
  }

  it('reports the logged-in username and server with active status', async () => {
    await seedStore({ username: 'eslroot', server: 'http://localhost:3000', token: 'token-123' });

    const result = await executeWhoami({ homeDir });

    expect(result.username).toBe('eslroot');
    expect(result.server).toBe('http://localhost:3000');
    expect(result.loggedIn).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.expiresAt).toBeTruthy();
  });

  it('reports the email recorded at login', async () => {
    await seedStore({ email: 'alice@example.com' });

    const result = await executeWhoami({ homeDir });

    expect(result.email).toBe('alice@example.com');
    expect(formatWhoami(result)).toContain('Email: alice@example.com');
  });

  it('omits the email line when no email was recorded', async () => {
    await seedStore({ email: null });

    const result = await executeWhoami({ homeDir });

    expect(result.email).toBeNull();
    expect(formatWhoami(result)).not.toContain('Email:');
  });

  it('reports expired status when loginAt is older than the TTL', async () => {
    await seedStore({ loginAt: new Date(Date.now() - 31 * 24 * 3_600_000).toISOString() });

    const result = await executeWhoami({ homeDir });

    expect(result.loggedIn).toBe(true);
    expect(result.expired).toBe(true);
  });

  it('annotates every organization with the identity held there', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        server: 'http://localhost:3000',
        username: 'alice',
        tools: [],
        organizations: [
          { org: 'acme', identity: 'ordinary', isOwnerMember: false },
          { org: 'beta', identity: 'owner', isOwnerMember: true }
        ]
      },
      { homeDir }
    );
    await saveCredentials({ token: 'token-123', loginAt: new Date().toISOString() }, { homeDir });

    const result = await executeWhoami({ homeDir });

    expect(formatWhoami(result)).toContain('Organization memberships: acme (ordinary), beta (owner)');
  });

  it('reports not logged in when there is no token', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://localhost:3000', username: null, tools: [] }, { homeDir });
    await saveCredentials({ token: null, loginAt: null }, { homeDir });

    const result = await executeWhoami({ homeDir });

    expect(result.loggedIn).toBe(false);
    expect(result.username).toBeNull();
  });

  describe('--online', () => {
    function mockOnline(profile: unknown, orgs: unknown): ReturnType<typeof vi.fn> {
      return vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/account/profile')) {
          return { ok: true, json: async () => profile };
        }
        if (url.endsWith('/api/orgs/mine')) {
          return { ok: true, json: async () => orgs };
        }
        throw new Error(`unexpected url ${url}`);
      });
    }

    it('verifies account details with the server and updates the local snapshot', async () => {
      await seedStore({ email: 'old@example.com' });
      const mockFetch = mockOnline(
        { username: 'alice', email: 'new@example.com' },
        {
          organizations: [
            { org: 'acme', identity: 'owner', isOwnerMember: true, status: 'active' },
            { org: 'beta', identity: 'ordinary', isOwnerMember: false, status: 'deleting' }
          ]
        }
      );

      const result = await executeWhoami({ homeDir, online: true, customFetch: mockFetch as any });

      expect(result.email).toBe('new@example.com');
      // deleting 的组织不算可正常使用的组织，按 init 同一口径过滤。
      expect(result.organizations).toEqual([{ org: 'acme', identity: 'owner', isOwnerMember: true }]);
      const config = await loadConfig({ homeDir });
      expect(config.email).toBe('new@example.com');
      expect(config.organizations).toEqual([{ org: 'acme', identity: 'owner', isOwnerMember: true }]);
    });

    it('does not extend the login session', async () => {
      const loginAt = new Date(Date.now() - 60_000).toISOString();
      await seedStore({ loginAt });
      const mockFetch = mockOnline({ email: 'new@example.com' }, { organizations: [] });

      await executeWhoami({ homeDir, online: true, customFetch: mockFetch as any });

      const credentials = JSON.parse(
        fs.readFileSync(path.join(homeDir, '.eslib', 'credentials.json'), 'utf8')
      );
      expect(credentials.loginAt).toBe(loginAt);
    });

    it('fails when not logged in', async () => {
      await initializeLocalStore({ homeDir });
      await saveConfig({ server: 'http://localhost:3000', username: null, tools: [] }, { homeDir });
      await saveCredentials({ token: null, loginAt: null }, { homeDir });

      await expect(
        executeWhoami({ homeDir, online: true, customFetch: vi.fn() as any })
      ).rejects.toThrow(/not logged in/i);
    });

    it('surfaces a server error instead of falling back to the local snapshot', async () => {
      await seedStore({ email: 'old@example.com' });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ code: 'unauthorizedInvalidToken', message: 'Invalid token' })
      });

      await expect(
        executeWhoami({ homeDir, online: true, customFetch: mockFetch as any })
      ).rejects.toThrow(/Invalid token/);
    });
  });
});
