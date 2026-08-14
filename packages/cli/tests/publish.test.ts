import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executePublish } from '../src/commands/publish.js';

describe('esl publish', () => {
  let tmpRoot: string;
  let skillDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-publish-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-publish-home-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    skillDir = path.join(tmpRoot, 'code-review');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@alice/code-review',
        version: '0.1.0',
        description: 'Code review skill',
        author: 'alice'
      })
    );
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: code-review
description: Use when reviewing code changes.
---

# Code Review
`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('pushes to the clone URL returned by the ESL Server', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git'
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledTimes(4);

    const remoteArgs = execFileAsync.mock.calls[0][1] as string[];
    expect(remoteArgs[0]).toBe('remote');
    expect(remoteArgs[1]).toBe('add');
    expect(remoteArgs[2]).toBe('esl');
    expect(remoteArgs[3]).toBe('http://localhost:3000/git/esl-skills/alice_code-review.git');
    expect(remoteArgs[3]).not.toContain('gitea-token');

    const pushArgSets = (execFileAsync.mock.calls.map((call) => call[1]) as string[][]).filter((args) =>
      args.includes('push')
    );
    expect(pushArgSets).toHaveLength(2);
    for (const args of pushArgSets) {
      expect(args.some((arg) => arg.includes('http.extraHeader') && arg.includes('gitea-token'))).toBe(true);
    }
  });

  it('updates an existing esl remote before publishing another release from the same repository', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git'
      })
    });
    const remoteExists = new Error('error: remote esl already exists.');
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args.join(' ') === 'remote add esl http://localhost:3000/git/esl-skills/alice_code-review.git') {
        throw remoteExists;
      }
      return { stdout: '', stderr: '' };
    });

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['remote', 'set-url', 'esl', 'http://localhost:3000/git/esl-skills/alice_code-review.git'],
      { cwd: skillDir }
    );
    expect(execFileAsync).toHaveBeenCalledWith('git', expect.arrayContaining(['push', 'esl', 'HEAD:main']), {
      cwd: skillDir
    });
  });

  it('rejects local namespace skills before registry or git side effects', async () => {
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@local/code-review',
        version: '0.1.0',
        description: 'Code review skill',
        author: 'alice'
      })
    );
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('@local/* skills use the local namespace and must be renamed to a stable namespace before publishing');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails when the ESL Server omits cloneUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@alice/code-review' })
    });

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow('API response did not include cloneUrl');
  });

  it('prompts for confirmation before pushing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git'
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const confirmInput = vi.fn().mockResolvedValue(true);

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      confirmInput,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(confirmInput).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('cancels when confirmation is declined', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();
    const confirmInput = vi.fn().mockResolvedValue(false);

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        confirmInput,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Publish cancelled');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails fast when --no-input is set without --force', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow('Publishing requires confirmation; pass --force to skip it');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails fast when the login has expired', async () => {
    await saveCredentials(
      { token: 'gitea-token', loginAt: new Date(Date.now() - 31 * 24 * 3_600_000).toISOString() },
      { homeDir }
    );
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow('Login expired; run esl login to re-authenticate');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails fast when login is missing', async () => {
    await saveCredentials({ token: null, loginAt: null }, { homeDir });
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Missing token; run esl login or pass --token');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails fast when no ESL Server is configured', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Missing server; run esl login or pass --server');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });
});
