import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, loadConfig, loadCredentials, saveConfig } from '@esl/core';
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
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', org: 'acme', role: 'member' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      org: 'acme',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('mock_skill_user_token');
    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://skills.company.com');
    expect(config.org).toBe('acme');
    expect(config.username).toBe('zhangsan');
    expect(config.role).toBe('member');
    expect(config).not.toHaveProperty('token');
    expect(config).not.toHaveProperty('gitBase');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org: 'acme', username: 'zhangsan', password: 'password123' })
      })
    );
  });

  it('records the login time when storing credentials', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', org: 'acme', role: 'member' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      org: 'acme',
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

  it('stores an organization token from a token file without contacting the server', async () => {
    const mockFetch = vi.fn();
    const tokenFile = path.join(homeDir, 'token.txt');
    fs.writeFileSync(tokenFile, 'pre_made_token');

    await executeLogin({
      server: 'http://skills.company.com',
      org: 'acme',
      username: 'zhangsan',
      tokenFile,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).not.toHaveBeenCalled();
    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('pre_made_token');
    const config = await loadConfig({ homeDir });
    expect(config.org).toBe('acme');
    expect(config.role).toBe('member');
  });

  it('derives the org-admin role from a token-file login without contacting the server', async () => {
    const tokenFile = path.join(homeDir, 'token.txt');
    fs.writeFileSync(tokenFile, 'pre_made_token');

    await executeLogin({
      server: 'http://skills.company.com',
      org: 'acme',
      username: 'admin',
      tokenFile,
      homeDir,
      customFetch: vi.fn() as any
    });

    const config = await loadConfig({ homeDir });
    expect(config.role).toBe('org-admin');
  });

  it('prompts for a password when no file is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', org: 'acme', role: 'member' })
    });

    await executeLogin({
      server: 'http://skills.company.com',
      org: 'acme',
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
        org: 'acme',
        username: 'zhangsan',
        noInput: true,
        homeDir,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow('pass --password-file or --token-file');
  });

  it('requires an organization in non-interactive mode', async () => {
    await expect(
      executeLogin({
        server: 'http://skills.company.com',
        username: 'zhangsan',
        noInput: true,
        homeDir,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/organization/i);
  });

  it('uses the saved server when --server is not passed', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: 'zhangsan', tools: [] }, { homeDir });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'zhangsan', org: 'acme', role: 'member' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      org: 'acme',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org: 'acme', username: 'zhangsan', password: 'password123' })
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
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', org: 'acme', role: 'member' })
    });
    const readUsername = vi.fn().mockResolvedValue('alice');
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({ org: 'acme', passwordFile, homeDir, readUsername, customFetch: mockFetch as any });

    expect(readUsername).toHaveBeenCalledWith('Username: ');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ org: 'acme', username: 'alice', password: 'password123' })
      })
    );
  });

  it('uses an explicit --username without prompting', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: 'ignored-user', tools: [] }, { homeDir });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', org: 'acme', role: 'member' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({ org: 'acme', username: 'alice', passwordFile, homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ org: 'acme', username: 'alice', password: 'password123' })
      })
    );
  });

  it('prompts for the username when none is passed', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: null, tools: [] }, { homeDir });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', org: 'acme', role: 'member' })
    });
    const readUsername = vi.fn().mockResolvedValue('alice');
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({ org: 'acme', passwordFile, homeDir, readUsername, customFetch: mockFetch as any });

    expect(readUsername).toHaveBeenCalledWith('Username: ');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ org: 'acme', username: 'alice', password: 'password123' })
      })
    );
  });

  it('prompts for the organization, then the username, then the password', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: null, tools: [] }, { homeDir });
    const calls: string[] = [];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock_skill_user_token', username: 'alice', org: 'acme', role: 'member' })
    });
    const readOrg = vi.fn(async () => {
      calls.push('org');
      return 'acme';
    });
    const readUsername = vi.fn(async () => {
      calls.push('username');
      return 'alice';
    });
    const readInput = vi.fn(async () => {
      calls.push('password');
      return 'password123';
    });

    await executeLogin({ homeDir, readOrg, readUsername, readInput, customFetch: mockFetch as any });

    expect(calls).toEqual(['org', 'username', 'password']);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://saved.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ org: 'acme', username: 'alice', password: 'password123' })
      })
    );
  });

  it('fails when no username is passed or provided interactively with --no-input', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://saved.company.com', username: null, tools: [] }, { homeDir });

    await expect(
      executeLogin({
        org: 'acme',
        noInput: true,
        passwordFile: path.join(homeDir, 'pw.txt'),
        homeDir,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/username/i);
  });
});
