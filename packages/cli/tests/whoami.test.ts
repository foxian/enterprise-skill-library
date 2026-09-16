import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';
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
    server?: string | null;
    token?: string | null;
    loginAt?: string | null;
  } = {}): Promise<void> {
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        server: overrides.server ?? 'http://localhost:3000',
        username: overrides.username ?? 'alice',
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
});
