import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '@esl/core';
import { executeLogin } from '../src/commands/login.js';

describe('esl login with organizations', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-login-org-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('sends the organization and username separately to the CLI login endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_token', username: 'zhangsan', org: 'acme', role: 'member' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      org: 'acme',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    // org_username 拼装交给服务端,CLI 只发送组织与用户名两个字段
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org: 'acme', username: 'zhangsan', password: 'password123' })
      })
    );
    const config = await loadConfig({ homeDir });
    expect(config.org).toBe('acme');
    expect(config.username).toBe('zhangsan');
    expect(config.role).toBe('member');
  });

  it('stores the organization for token-file logins without contacting the server', async () => {
    const mockFetch = vi.fn();
    const tokenFile = path.join(homeDir, 'token.txt');
    fs.writeFileSync(tokenFile, 'pre_made_token');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      org: 'acme',
      tokenFile,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).not.toHaveBeenCalled();
    const config = await loadConfig({ homeDir });
    expect(config.org).toBe('acme');
  });

  it('prompts for the organization through the injected reader', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_token', username: 'zhangsan', org: 'acme', role: 'member' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any,
      readOrg: async () => 'acme'
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ org: 'acme', username: 'zhangsan', password: 'password123' })
      })
    );
  });

  it('derives the org-admin role from the server response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_token', username: 'admin', org: 'acme', role: 'org-admin' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      org: 'acme',
      username: 'admin',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    const config = await loadConfig({ homeDir });
    expect(config.org).toBe('acme');
    expect(config.role).toBe('org-admin');
  });
});
