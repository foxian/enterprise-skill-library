import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, loadConfig, loadCredentials, saveConfig } from '@esl/core';
import { executeLogin } from '../src/commands/login.js';

// 全局身份登录（ADR-0032）：username + password 一条凭据，无组织输入。
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
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', organizations: [] })
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
    expect(config).not.toHaveProperty('org');
    expect(config).not.toHaveProperty('role');
    expect(config).not.toHaveProperty('token');
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
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', organizations: [] })
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

  it('stores a token from a token file without contacting the server', async () => {
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
    const config = await loadConfig({ homeDir });
    expect(config.username).toBe('zhangsan');
    expect(config.organizations).toEqual([]);
  });

  it('prompts for a password when no file is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', organizations: [] })
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

  it('uses the saved server when --server is not passed', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: 'zhangsan', tools: [] }, { homeDir });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', organizations: [] })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'zhangsan', password: 'password123' })
      })
    );
  });

  it('fails when no server is passed or saved', async () => {
    await initializeLocalStore({ homeDir });

    await expect(
      executeLogin({
        username: 'zhangsan',
        noInput: true,
        homeDir,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/server/i);
  });

  it('always prompts for the username, ignoring a saved username', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: 'eslroot', tools: [] }, { homeDir });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', organizations: [] })
    });
    const readUsername = vi.fn().mockResolvedValue('alice');
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({ passwordFile, homeDir, readUsername, customFetch: mockFetch as any });

    expect(readUsername).toHaveBeenCalledWith('Username: ');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ username: 'alice', password: 'password123' })
      })
    );
  });

  it('uses an explicit --username without prompting', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: 'ignored-user', tools: [] }, { homeDir });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', organizations: [] })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({ username: 'alice', passwordFile, homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ username: 'alice', password: 'password123' })
      })
    );
  });

  it('prompts for the username when none is passed', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: null, tools: [] }, { homeDir });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', organizations: [] })
    });
    const readUsername = vi.fn().mockResolvedValue('alice');
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({ passwordFile, homeDir, readUsername, customFetch: mockFetch as any });

    expect(readUsername).toHaveBeenCalledWith('Username: ');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ username: 'alice', password: 'password123' })
      })
    );
  });

  it('prompts for the username, then the password', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: null, tools: [] }, { homeDir });
    const calls: string[] = [];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', organizations: [] })
    });
    const readUsername = vi.fn(async () => {
      calls.push('username');
      return 'alice';
    });
    const readInput = vi.fn(async () => {
      calls.push('password');
      return 'password123';
    });

    await executeLogin({ homeDir, readUsername, readInput, customFetch: mockFetch as any });

    expect(calls).toEqual(['username', 'password']);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ username: 'alice', password: 'password123' })
      })
    );
  });

  it('fails when no username is passed or provided interactively with --no-input', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: null, tools: [] }, { homeDir });

    await expect(
      executeLogin({
        noInput: true,
        passwordFile: path.join(homeDir, 'pw.txt'),
        homeDir,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/username/i);
  });
});
