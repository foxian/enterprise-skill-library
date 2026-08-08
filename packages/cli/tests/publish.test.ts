import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executePublish } from '../src/commands/publish.js';

describe('esl publish', () => {
  let tmpRoot: string;
  let skillDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-publish-'));
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
  });

  it('pushes to the repository path returned by the registry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review'
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    await executePublish({
      directory: skillDir,
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['remote', 'add', 'esl', expect.stringContaining('/esl-skills/alice_code-review.git')],
      { cwd: skillDir }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledTimes(4);
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
        registry: 'http://localhost:3000/api',
        gitBase: 'http://localhost:3001',
        token: 'gitea-token',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('@local/* skills use the local namespace and must be renamed to a stable namespace before publishing');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails when the registry omits gitRepoPath', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@alice/code-review' })
    });

    await expect(
      executePublish({
        directory: skillDir,
        registry: 'http://localhost:3000/api',
        gitBase: 'http://localhost:3001',
        token: 'gitea-token',
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow('API response did not include gitRepoPath');
  });
});
