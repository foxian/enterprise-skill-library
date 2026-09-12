import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore } from '@esl/core';
import { executeResetSource } from '../src/commands/reset-source.js';

describe('esl reset-source', () => {
  let tmpRoot: string;
  let skillDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-reset-'));
    skillDir = path.join(tmpRoot, 'reviewer');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'release.json'),
      JSON.stringify({ schemaVersion: 2, version: '0.1.0', license: 'MIT', keywords: [], compatibility: {}, dependencies: {} })
    );
    fs.mkdirSync(path.join(skillDir, '.git'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-reset-home-'));
    await initializeLocalStore({ homeDir });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function gitMock(opts: { remoteUrl?: string | null } = {}) {
    return vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        if (opts.remoteUrl === null) return Promise.reject(new Error('no such remote'));
        return Promise.resolve({ stdout: `${opts.remoteUrl ?? 'http://localhost:3000/git/platform-ai/reviewer.git'}\n`, stderr: '' });
      }
      // remote remove succeeds silently; other git calls echo.
      return Promise.resolve({ stdout: `git ${args.join(' ')}\n`, stderr: '' });
    });
  }

  it('removes the esl remote and renames release.json to a backup', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Skill not found'));
    const execFileAsync = gitMock();

    const result = await executeResetSource({
      directory: skillDir,
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result.remoteUrl).toBe('http://localhost:3000/git/platform-ai/reviewer.git');
    expect(result.releaseManifestRenamedTo).toBe(path.join(skillDir, 'release.json.before-reset'));
    expect(fs.existsSync(path.join(skillDir, 'release.json'))).toBe(false);
    expect(fs.existsSync(path.join(skillDir, 'release.json.before-reset'))).toBe(true);
    expect(execFileAsync).toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
    expect(execFileAsync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['push']), expect.anything());
  });

  it('hard-blocks when the identity is still visible on the server unless --force', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: '@platform-ai/reviewer',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = gitMock();

    await expect(
      executeResetSource({
        directory: skillDir,
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/still exists on the configured ESL server/);
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
    expect(fs.existsSync(path.join(skillDir, 'release.json'))).toBe(true);

    // --force 显式表态「明知源还在仍要脱管」才放行。
    const result = await executeResetSource({
      directory: skillDir,
      homeDir,
      server: 'http://localhost:3000',
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });
    expect(result.releaseManifestRenamedTo).toBe(path.join(skillDir, 'release.json.before-reset'));
    expect(execFileAsync).toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
  });

  it('fails without --force in a non-interactive run', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Skill not found'));
    const execFileAsync = gitMock();

    await expect(
      executeResetSource({
        directory: skillDir,
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/--force/);
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
  });

  it('refuses to run when there is no esl remote', async () => {
    const execFileAsync = gitMock({ remoteUrl: null });

    await expect(
      executeResetSource({
        directory: skillDir,
        homeDir,
        force: true,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/no esl remote/);
  });

  it('errors when a previous backup collides without touching the remote', async () => {
    fs.writeFileSync(path.join(skillDir, 'release.json.before-reset'), 'old backup');
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Skill not found'));
    const execFileAsync = gitMock();

    await expect(
      executeResetSource({
        directory: skillDir,
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/previous reset backup already exists/);
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
    expect(fs.existsSync(path.join(skillDir, 'release.json'))).toBe(true);
  });
});
