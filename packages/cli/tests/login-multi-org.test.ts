import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '@esl/core';
import { executeLogin } from '../src/commands/login.js';

// 全局身份登录（ADR-0032）：一次登录即返回全部组织隶属，无需按组织分别登录。
describe('esl login with organizations', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-login-org-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('sends only the username and password to the CLI login endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'mock_token',
        username: 'zhangsan',
        organizations: [{ org: 'acme', role: 'member' }]
      })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'zhangsan', password: 'password123' })
      })
    );
    const config = await loadConfig({ homeDir });
    expect(config.username).toBe('zhangsan');
    expect(config.organizations).toEqual([{ org: 'acme', role: 'member' }]);
    expect(config).not.toHaveProperty('org');
    expect(config).not.toHaveProperty('role');
  });

  it('stores the multi-organization list returned by the server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'mock_token',
        username: 'alice',
        organizations: [
          { org: 'acme', role: 'member' },
          { org: 'beta', role: 'org-admin' }
        ]
      })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'alice',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    const config = await loadConfig({ homeDir });
    expect(config.organizations).toEqual([
      { org: 'acme', role: 'member' },
      { org: 'beta', role: 'org-admin' }
    ]);
  });

  it('stores an empty organization list for token-file logins without contacting the server', async () => {
    const mockFetch = vi.fn();
    const tokenFile = path.join(homeDir, 'token.txt');
    fs.writeFileSync(tokenFile, 'pre_made_token');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      tokenFile,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).not.toHaveBeenCalled();
    const config = await loadConfig({ homeDir });
    expect(config.organizations).toEqual([]);
  });

  it('tolerates a server response without an organizations field', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_token', username: 'zhangsan' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    const config = await loadConfig({ homeDir });
    expect(config.organizations).toEqual([]);
  });
});
