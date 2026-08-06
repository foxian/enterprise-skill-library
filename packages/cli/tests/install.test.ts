import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { executeInstall } from '../src/commands/install.js';

describe('esl install (global mode)', () => {
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
    const homeDir = 'C:\\temp\\esl-install-home';

    await executeInstall('@alice/code-review', {
      homeDir,
      global: true,
      noAdapt: true,
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

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
