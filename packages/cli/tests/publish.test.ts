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
      path.join(skillDir, 'release.json'),
      JSON.stringify({
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
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

  it('creates a minimal release.json when missing and guides the user to commit before publishing', async () => {
    fs.rmSync(path.join(skillDir, 'release.json'));
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        license: 'Apache-2.0',
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Created release.json in the source directory; commit it and push to esl/main');

    const created = JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'));
    expect(created).toEqual({
      schemaVersion: 1,
      license: 'Apache-2.0',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('defaults to MIT when release.json is missing and no license is passed', async () => {
    fs.rmSync(path.join(skillDir, 'release.json'));
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Created release.json in the source directory; commit it and push to esl/main');

    const created = JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'));
    expect(created).toEqual({
      schemaVersion: 1,
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('publishes a release manifest from a clean HEAD already on esl/main without pushing source', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/code-review',
        version: '1.0.0',
        sourceCommit: 'abc123',
        packageUrl: '/api/packages/sk_123/1.0.0/sha.json'
      })
    });
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await executePublish({
      directory: skillDir,
      version: '1.0.0',
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40platform-ai%2Fcode-review/releases',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"sourceCommit":"abc123"')
      })
    );
    expect((execFileAsync.mock.calls as [string, string[]][]).some(([, args]) => args.includes('push'))).toBe(false);
  });

  it('rejects a dirty release worktree before calling the server', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: ' M SKILL.md\n', stderr: '' });

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('working tree is not clean');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('guides the user to esl upload when the directory has no esl remote', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        throw new Error('No such remote: esl');
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('no esl remote; run esl upload first');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a source whose esl remote infers a local namespace', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/local/code-review.git\n', stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('@local/* skills use the local namespace and must be renamed to a stable namespace');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a HEAD that differs from esl/main', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'def456\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('local HEAD must be pushed and equal to esl/main');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires a version for source-form releases', async () => {
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
    ).rejects.toThrow('Release version is required');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('prompts for confirmation before publishing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/code-review',
        version: '1.0.0',
        sourceCommit: 'abc123',
        packageUrl: '/api/packages/sk_123/1.0.0/sha.json'
      })
    });
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    const confirmInput = vi.fn().mockResolvedValue(true);

    await executePublish({
      directory: skillDir,
      version: '1.0.0',
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
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    const confirmInput = vi.fn().mockResolvedValue(false);

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        confirmInput,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Publish cancelled');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect((execFileAsync.mock.calls as [string, string[]][]).some(([, args]) => args.includes('push'))).toBe(false);
  });

  it('sends the --message text as the release notes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@platform-ai/code-review', version: '1.0.0' })
    });
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await executePublish({
      directory: skillDir,
      version: '1.0.0',
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      message: 'fix: dead-link regex',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({ body: expect.stringContaining('"notes":"fix: dead-link regex"') })
    );
  });

  it('auto-collects the commit messages since the last release tag as the notes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@platform-ai/code-review', version: '1.0.0' })
    });
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      if (args[0] === 'describe') return { stdout: 'v1.0.0\n', stderr: '' };
      if (args[0] === 'log') return { stdout: 'fix: dead-link regex\nfeat: docx batch\n', stderr: '' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await executePublish({
      directory: skillDir,
      version: '1.0.0',
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({
        body: expect.stringContaining('"notes":"- fix: dead-link regex\\n- feat: docx batch"')
      })
    );
  });

  it('lets an interactive note input override the collected notes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@platform-ai/code-review', version: '1.0.0' })
    });
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      if (args[0] === 'describe') return { stdout: 'v1.0.0\n', stderr: '' };
      if (args[0] === 'log') return { stdout: 'fix: dead-link regex\n', stderr: '' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await executePublish({
      directory: skillDir,
      version: '1.0.0',
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      noteInput: async () => 'custom manual note',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({ body: expect.stringContaining('"notes":"custom manual note"') })
    );
  });

  it('falls back to the collected notes when the note input is empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@platform-ai/code-review', version: '1.0.0' })
    });
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      if (args[0] === 'describe') return { stdout: 'v1.0.0\n', stderr: '' };
      if (args[0] === 'log') return { stdout: 'fix: dead-link regex\n', stderr: '' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await executePublish({
      directory: skillDir,
      version: '1.0.0',
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      noteInput: async () => '',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({ body: expect.stringContaining('"notes":"- fix: dead-link regex"') })
    );
  });

  it('fails fast when --no-input is set without --force', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'http://localhost:3000/git/platform-ai/code-review.git\n', stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    await expect(
      executePublish({
        directory: skillDir,
        version: '1.0.0',
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Publishing requires confirmation; pass --force to skip it');

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});