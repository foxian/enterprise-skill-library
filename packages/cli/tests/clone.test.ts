import { describe, expect, it, vi } from 'vitest';
import { executeClone } from '../src/commands/clone.js';

describe('esl clone', () => {
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

    const targetDir = await executeClone('@alice/code-review', {
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      cwd: '/tmp/test-dir'
    });

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

    const targetDir = await executeClone('@alice/code-review', {
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
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
