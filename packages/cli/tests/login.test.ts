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
      json: async () => ({ sha1: 'mock_gitea_token_sha1' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      registry: 'http://skills.company.com/api',
      gitBase: 'http://skills.company.com/git',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('mock_gitea_token_sha1');
    const config = await loadConfig({ homeDir });
    expect(config.username).toBe('zhangsan');
    expect(config).not.toHaveProperty('token');
  });

  it('stores a token from a token file without contacting the Git backend', async () => {
    const mockFetch = vi.fn();
    const tokenFile = path.join(homeDir, 'token.txt');
    fs.writeFileSync(tokenFile, 'pre_made_token');

    await executeLogin({
      registry: 'http://skills.company.com/api',
      gitBase: 'http://skills.company.com/git',
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
      json: async () => ({ sha1: 'mock_gitea_token_sha1' })
    });

    await executeLogin({
      registry: 'http://skills.company.com/api',
      gitBase: 'http://skills.company.com/git',
      username: 'zhangsan',
      readInput: async () => 'password123',
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('mock_gitea_token_sha1');
  });

  it('fails fast with --no-input when no credential file is provided', async () => {
    await expect(
      executeLogin({
        registry: 'http://skills.company.com/api',
        gitBase: 'http://skills.company.com/git',
        username: 'zhangsan',
        noInput: true,
        homeDir,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow('pass --password-file or --token-file');
  });
});
