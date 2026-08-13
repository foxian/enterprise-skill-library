import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeInstall } from '../src/commands/install.js';

describe('esl install (global mode)', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-install-home-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token' }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('clones a scoped skill into the scoped global path with --global', async () => {
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

    try {
      await executeInstall('@alice/code-review', {
        homeDir,
        global: true,
        noAdapt: true,
        registry: 'http://localhost:3000/api',
        gitBase: 'http://localhost:3001',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      });
    } finally {
      stderrSpy.mockRestore();
    }

    expect(notified).toBe(true);
    expect(execFileAsync).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'clone',
        expect.stringContaining('/esl-skills/alice_code-review.git'),
        path.join(homeDir, '.skill-library', 'skills', '@alice', 'code-review')
      ]
    );
  });
});
