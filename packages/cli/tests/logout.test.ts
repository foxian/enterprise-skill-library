import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeLocalStore, loadCredentials, loadConfig, saveConfig, saveCredentials, saveSkillsJson } from '@esl/core';
import { executeLogout, formatLogout } from '../src/commands/logout.js';
import { executeWhoami, formatWhoami } from '../src/commands/whoami.js';

describe('esl logout', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-logout-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('clears the stored credentials and keeps the config', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig(
      { server: 'http://skills.company.com', username: 'zhangsan', org: 'acme', role: 'member', tools: [] },
      { homeDir }
    );
    await saveCredentials({ token: 'mock_token', loginAt: new Date().toISOString() }, { homeDir });

    const result = await executeLogout({ homeDir });

    expect(result.hadCredentials).toBe(true);
    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBeNull();
    expect(credentials.loginAt).toBeNull();

    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://skills.company.com');
    expect(config.username).toBe('zhangsan');
    expect(config.org).toBe('acme');
    expect(config.role).toBe('member');
  });

  it('is idempotent when no local store exists', async () => {
    const result = await executeLogout({ homeDir });

    expect(result.hadCredentials).toBe(false);
    const credentials = await loadCredentials({ homeDir });
    expect(credentials).toEqual({ token: null, loginAt: null });
  });

  it('reports the logged-out state through whoami afterwards', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ username: 'zhangsan', org: 'acme', role: 'member' }, { homeDir });
    await saveCredentials({ token: 'mock_token', loginAt: new Date().toISOString() }, { homeDir });
    await executeLogout({ homeDir });

    const result = await executeWhoami({ homeDir });

    expect(result.loggedIn).toBe(false);
    expect(formatWhoami(result)).toContain('Not logged in');
  });

  it('formats the logout message for both outcomes', () => {
    expect(formatLogout({ hadCredentials: true })).toMatch(/Logged out/);
    expect(formatLogout({ hadCredentials: false })).toMatch(/Not logged in/);
  });

  it('makes token-requiring commands fail with a login hint afterwards', async () => {
    await initializeLocalStore({ homeDir });
    const globalRoot = path.join(homeDir, '.skill-library');
    await saveSkillsJson(globalRoot, { skills: { '@acme/code-review': '^1.0.0' } });
    await saveCredentials({ token: 'mock_token', loginAt: new Date().toISOString() }, { homeDir });

    await executeLogout({ homeDir });

    const { executeUpdate } = await import('../src/commands/update.js');
    await expect(
      executeUpdate({
        projectRoot: homeDir,
        homeDir,
        global: true,
        server: 'http://localhost:3000',
        noAdapt: true
      })
    ).rejects.toThrow('Missing token; run esl login or pass --token');
  });
});
