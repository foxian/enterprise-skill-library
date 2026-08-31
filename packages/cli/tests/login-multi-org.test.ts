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

  it('assembles the Gitea username from the organization for password login', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_token', username: 'acme_zhangsan' })
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

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'acme_zhangsan', password: 'password123' })
      })
    );
    const config = await loadConfig({ homeDir });
    expect(config.org).toBe('acme');
    expect(config.username).toBe('zhangsan');
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
      json: async () => ({ token: 'mock_token', username: 'acme_zhangsan' })
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
        body: JSON.stringify({ username: 'acme_zhangsan', password: 'password123' })
      })
    );
  });

  it('keeps the plain username when no organization is given', async () => {
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

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ username: 'zhangsan', password: 'password123' })
      })
    );
    const config = await loadConfig({ homeDir });
    expect(config.org).toBeNull();
  });
});
