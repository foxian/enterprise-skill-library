import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '@esl/core';
import { executeLogin } from '../src/commands/login.js';

describe('esl login', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-login-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('authenticates with Gitea and saves config', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sha1: 'mock_gitea_token_sha1' })
    });

    await executeLogin({
      registry: 'http://skills.company.com/api',
      gitBase: 'http://skills.company.com/git',
      username: 'zhangsan',
      password: 'password123',
      homeDir,
      customFetch: mockFetch as any
    });

    const config = await loadConfig({ homeDir });
    expect(config.token).toBe('mock_gitea_token_sha1');
    expect(config.username).toBe('zhangsan');
  });
});
