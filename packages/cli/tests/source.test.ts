import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeSource } from '../src/commands/source.js';

describe('esl source', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-source-home-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('clones the full git repository to the target directory', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    let notified = false;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      if (typeof chunk === 'string' && chunk.includes('Cloning')) {
        notified = true;
      }
      return true;
    });

    let targetDir: string;
    try {
      targetDir = await executeSource('@alice/code-review', {
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any,
        cwd: '/tmp/test-dir'
      });
    } finally {
      stderrSpy.mockRestore();
    }

    expect(notified).toBe(true);
    expect(targetDir).toContain('code-review');
    expect(execFileAsync).toHaveBeenCalledWith('git', [
      '-c',
      'http.extraHeader=Authorization: Bearer gitea-token',
      'clone',
      'http://localhost:3000/git/esl-skills/alice_code-review.git',
      expect.stringContaining('code-review')
    ]);
  });

  it('clones to a custom target directory', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const targetDir = await executeSource('@alice/code-review', {
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      target: '/tmp/my-clone-dir'
    });

    expect(targetDir).toBe('/tmp/my-clone-dir');
    expect(execFileAsync).toHaveBeenCalledWith('git', [
      '-c',
      'http.extraHeader=Authorization: Bearer gitea-token',
      'clone',
      'http://localhost:3000/git/esl-skills/alice_code-review.git',
      '/tmp/my-clone-dir'
    ]);
  });

  it('fails fast when login is missing', async () => {
    await saveCredentials({ token: null, loginAt: null }, { homeDir });
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeSource('@alice/code-review', {
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any,
        target: '/tmp/my-clone-dir'
      })
    ).rejects.toThrow('Missing token; run esl login or pass --token');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails fast when the login is expired', async () => {
    await saveCredentials(
      { token: 'gitea-token', loginAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() },
      { homeDir }
    );
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeSource('@alice/code-review', {
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any,
        target: '/tmp/my-clone-dir'
      })
    ).rejects.toThrow('Login expired; run esl login to re-authenticate');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails clearly when no ESL Server is configured', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeSource('@alice/code-review', {
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any,
        target: '/tmp/my-clone-dir'
      })
    ).rejects.toThrow('Missing server; run esl login or pass --server');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });
});
