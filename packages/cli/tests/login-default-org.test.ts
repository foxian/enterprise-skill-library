import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '@esl/core';
import { executeLogin } from '../src/commands/login.js';

describe('esl login adapting to the platform default organization', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-login-default-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  // 按 URL 路由的 fetch mock:platform-info 返回可配置的默认组织,auth/login 返回 token
  function platformFetch(defaultOrg: string | null) {
    return vi.fn(async (url: string) => {
      if (String(url).includes('/api/public/platform-info')) {
        return {
          ok: true,
          json: async () => ({ mode: defaultOrg ? 'single' : 'multi', defaultOrg })
        };
      }
      return {
        ok: true,
        json: async () => ({ token: 'mock_token', username: 'zhangsan', org: 'acme', role: 'member' })
      };
    });
  }

  it('skips the organization prompt and logs into the default org when one is set', async () => {
    const mockFetch = platformFetch('acme');
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');
    const readOrg = vi.fn();

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any,
      readOrg
    });

    expect(readOrg).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ org: 'acme', username: 'zhangsan', password: 'password123' })
      })
    );
    const config = await loadConfig({ homeDir });
    expect(config.org).toBe('acme');
  });

  it('still prompts for the organization when no default org is set', async () => {
    const mockFetch = platformFetch(null);
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

  it('honors an explicit --org override without consulting platform-info', async () => {
    const mockFetch = vi.fn();
    const tokenFile = path.join(homeDir, 'token.txt');
    fs.writeFileSync(tokenFile, 'pre_made_token');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      org: 'other',
      tokenFile,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).not.toHaveBeenCalled();
    const config = await loadConfig({ homeDir });
    expect(config.org).toBe('other');
  });

  it('resolves the default org in --no-input mode without requiring --org', async () => {
    const mockFetch = platformFetch('acme');
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      server: 'http://skills.company.com',
      username: 'zhangsan',
      passwordFile,
      noInput: true,
      homeDir,
      customFetch: mockFetch as any
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ org: 'acme', username: 'zhangsan', password: 'password123' })
      })
    );
  });
});
