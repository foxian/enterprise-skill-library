import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeUse } from '../src/commands/use.js';

describe('esl use', () => {
  it('reads SKILL.md from a local directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));
    const skillContent = '---\nname: test-skill\ndescription: A test skill.\n---\n\n# Test Skill\n\nDo the thing.\n';
    await fs.writeFile(path.join(tmpDir, 'SKILL.md'), skillContent);

    const result = await executeUse(tmpDir);

    expect(result).toBe(skillContent);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('throws when SKILL.md is missing from local directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));

    await expect(executeUse(tmpDir)).rejects.toThrow();
    await fs.rm(tmpDir, { recursive: true });
  });

  it('reads SKILL.md using a path starting with dot', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));
    const subDir = path.join(tmpDir, 'my-skill');
    await fs.mkdir(subDir);
    const skillContent = '---\nname: relative-skill\ndescription: Relative path test.\n---\n\nInstructions here.\n';
    await fs.writeFile(path.join(subDir, 'SKILL.md'), skillContent);

    const result = await executeUse(subDir);
    expect(result).toBe(skillContent);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('reads SKILL.md from a server clone URL with token authentication headers', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-home-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['0.1.0']
      })
    });
    const skillContent = '---\nname: code-review\ndescription: Test.\n---\n';
    const execFileAsync = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes('clone')) {
        const cloneDir = args.at(-1)!;
        fsSync.mkdirSync(cloneDir, { recursive: true });
        fsSync.writeFileSync(path.join(cloneDir, 'SKILL.md'), skillContent);
      }
      return { stdout: '', stderr: '' };
    });

    const result = await executeUse('@alice/code-review', {
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toBe(skillContent);
    expect(execFileAsync).toHaveBeenCalledWith('git', [
      '-c',
      'http.extraHeader=Authorization: Bearer gitea-token',
      'clone',
      '--depth',
      '1',
      'http://localhost:3000/git/esl-skills/alice_code-review.git',
      expect.any(String)
    ]);
    await fs.rm(homeDir, { recursive: true });
  });

  it('checks out the highest stable version, not the most recently published one', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-home-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['1.0.0', '1.2.0', '1.3.0-beta.1']
      })
    });
    const checkedOut: string[] = [];
    const execFileAsync = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes('clone')) {
        const cloneDir = args.at(-1)!;
        fsSync.mkdirSync(cloneDir, { recursive: true });
        fsSync.writeFileSync(path.join(cloneDir, 'SKILL.md'), '---\nname: code-review\ndescription: Test.\n---\n');
      }
      if (args.includes('checkout')) {
        checkedOut.push(args[args.length - 1]);
      }
      return { stdout: '', stderr: '' };
    });

    await executeUse('@alice/code-review', {
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(checkedOut).toEqual(['1.2.0']);
    await fs.rm(homeDir, { recursive: true });
  });
});
