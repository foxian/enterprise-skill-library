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
        gitRepoPath: 'esl-skills/alice_code-review',
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
        registry: 'http://localhost:3000/api',
        gitBase: 'http://localhost:3001',
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
      'clone',
      expect.stringContaining('/esl-skills/alice_code-review.git'),
      expect.stringContaining('code-review')
    ]);
  });

  it('clones to a custom target directory', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const targetDir = await executeSource('@alice/code-review', {
      homeDir,
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      target: '/tmp/my-clone-dir'
    });

    expect(targetDir).toBe('/tmp/my-clone-dir');
    expect(execFileAsync).toHaveBeenCalledWith('git', [
      'clone',
      expect.stringContaining('/esl-skills/alice_code-review.git'),
      '/tmp/my-clone-dir'
    ]);
  });
});
