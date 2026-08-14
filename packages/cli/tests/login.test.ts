import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadCredentials } from '@esl/core';
import { executeLogin } from '../src/commands/login.js';

describe('esl login', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-login-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('exchanges a password file for a token and stores it', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan' })
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

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('mock_skill_user_token');
    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://skills.company.com');
    expect(config.username).toBe('zhangsan');
    expect(config).not.toHaveProperty('token');
    expect(config).not.toHaveProperty('gitBase');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'zhangsan', password: 'password123' })
      })
    );
  });

  it('records the login time when storing credentials', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan' })
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

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('mock_skill_user_token');
    expect(credentials.loginAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(credentials.loginAt as string))).toBe(false);
  });

  it('stores a token from a token file without contacting the Git backend', async () => {
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
    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('pre_made_token');
  });

  it('prompts for a password when no file is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan' })
    });

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      readInput: async () => 'password123',
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('mock_skill_user_token');
  });

  it('fails fast with --no-input when no credential file is provided', async () => {
    await expect(
      executeLogin({
        server: 'http://skills.company.com',
        username: 'zhangsan',
        noInput: true,
        homeDir,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow('pass --password-file or --token-file');
  });
});
