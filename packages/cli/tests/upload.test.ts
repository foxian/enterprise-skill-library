import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';
import { executeUpload } from '../src/commands/upload.js';

describe('esl upload', () => {
  let tmpRoot: string;
  let skillDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-upload-'));
    skillDir = path.join(tmpRoot, 'reviewer');
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
      '---\nname: reviewer\ndescription: Shared reviewer\n---\n'
    );
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-upload-home-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function gitMock(
    opts: {
      inRepo?: boolean;
      dirty?: string;
      userName?: string;
      userEmail?: string;
      localHead?: string;
      remoteHead?: string | null;
      behind?: number;
      rebaseConflict?: boolean;
      remoteUrl?: string | null;
    } = {}
  ) {
    const {
      inRepo = true,
      dirty = '',
      userName = '',
      userEmail = '',
      localHead = 'local-head',
      remoteHead = 'remote-head',
      behind = 0,
      rebaseConflict = false,
      remoteUrl = 'http://localhost:3000/git/platform-ai/reviewer.git'
    } = opts;
    return vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        if (remoteUrl === null) return Promise.reject(new Error('no such remote'));
        return Promise.resolve({ stdout: `${remoteUrl}\n`, stderr: '' });
      }
      if (args[0] === 'rev-parse' && args.includes('--is-inside-work-tree')) {
        if (inRepo) return Promise.resolve({ stdout: 'true\n', stderr: '' });
        return Promise.reject(new Error('fatal: not a git repository'));
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return Promise.resolve({ stdout: `${localHead}\n`, stderr: '' });
      }
      if (args[0] === 'rev-parse' && args.includes('--verify')) {
        if (remoteHead === null) return Promise.reject(new Error('fatal: ambiguous argument'));
        return Promise.resolve({ stdout: `${remoteHead}\n`, stderr: '' });
      }
      if (args[0] === 'rev-list') {
        return Promise.resolve({ stdout: `${behind}\n`, stderr: '' });
      }
      if (args[0] === 'rebase' && args[1] === 'esl/main' && rebaseConflict) {
        return Promise.reject(new Error('CONFLICT (content): Merge conflict in SKILL.md'));
      }
      if (args[0] === 'config' && args[1] === 'user.name') {
        if (args.length === 2) {
          return userName ? Promise.resolve({ stdout: `${userName}\n`, stderr: '' }) : Promise.reject(new Error('not set'));
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (args[0] === 'config' && args[1] === 'user.email') {
        if (args.length === 2) {
          return userEmail ? Promise.resolve({ stdout: `${userEmail}\n`, stderr: '' }) : Promise.reject(new Error('not set'));
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (args[0] === 'status') {
        return Promise.resolve({ stdout: dirty, stderr: '' });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });
  }

  const uploadResponse = {
    name: '@platform-ai/reviewer',
    skillId: 'sk_01J00000000000000000000000',
    cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
  };

  it('creates a server source and adds the esl remote without changing origin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return Promise.resolve({ stdout: 'local\n', stderr: '' });
      if (args[0] === 'rev-parse' && args.includes('--verify')) return Promise.resolve({ stdout: 'remote\n', stderr: '' });
      if (args[0] === 'rev-list') return Promise.resolve({ stdout: '0\n', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer', skillId: 'sk_01J00000000000000000000000' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/upload',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'reviewer', description: 'Shared reviewer' })
      })
    );
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['remote', 'add', 'esl', 'http://localhost:3000/git/platform-ai/reviewer.git'],
      { cwd: skillDir }
    );
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('creates a minimal release.json and commits it when missing, uploading in one pass', async () => {
    fs.rmSync(path.join(skillDir, 'release.json'));
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = gitMock({ dirty: '?? release.json\n' });

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      license: 'Apache-2.0',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    const created = JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'));
    expect(created).toEqual({
      schemaVersion: 1,
      license: 'Apache-2.0',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'chore: commit skill source for esl upload'],
      { cwd: skillDir }
    );
    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
  });

  it('fails without --no-input when a license is needed and none is provided', async () => {
    fs.rmSync(path.join(skillDir, 'release.json'));
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('a license is required to create release.json');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('syncs directly to the existing source without a registration call when the esl remote is present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return Promise.resolve({ stdout: 'http://localhost:3000/git/platform-ai/reviewer.git\n', stderr: '' });
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return Promise.resolve({ stdout: 'local\n', stderr: '' });
      if (args[0] === 'rev-parse' && args.includes('--verify')) return Promise.resolve({ stdout: 'remote\n', stderr: '' });
      if (args[0] === 'rev-list') return Promise.resolve({ stdout: '0\n', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('blocks the upload when the local skill name does not match the existing source repository', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return Promise.resolve({ stdout: 'http://localhost:3000/git/other/skill.git\n', stderr: '' });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    await expect(
      executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/does not match the source repository/);
    expect(execFileAsync).not.toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('guides the user to push when the registered source push fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args.includes('push')) {
        return Promise.reject(new Error('fatal: unable to access'));
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return Promise.resolve({ stdout: 'local\n', stderr: '' });
      if (args[0] === 'rev-parse' && args.includes('--verify')) return Promise.resolve({ stdout: 'remote\n', stderr: '' });
      if (args[0] === 'rev-list') return Promise.resolve({ stdout: '0\n', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    await expect(
      executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/git push esl HEAD:main/);
  });

  it('resolves the server from local config when --server is omitted', async () => {
    await saveConfig({ server: 'http://localhost:3000' }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const result = await executeUpload({
      directory: skillDir,
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3000/api/skills/upload', expect.anything());
  });

  it('initializes a git repository and writes a base .gitignore when the skill directory is not a repository', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ inRepo: false, remoteUrl: null });

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(execFileAsync).toHaveBeenCalledWith('git', ['init'], { cwd: skillDir });
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['remote', 'add', 'esl', 'http://localhost:3000/git/platform-ai/reviewer.git'],
      { cwd: skillDir }
    );
    expect(fs.existsSync(path.join(skillDir, '.gitignore'))).toBe(true);
  });

  it('commits uncommitted changes before uploading', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ dirty: ' M SKILL.md\n' });

    await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).toHaveBeenCalledWith('git', ['add', '-A'], { cwd: skillDir });
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'chore: commit skill source for esl upload'],
      { cwd: skillDir }
    );
  });

  it('skips the auto-commit when the working tree is clean', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ dirty: '' });

    await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['add', '-A'], { cwd: skillDir });
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['commit', expect.anything()], { cwd: skillDir });
  });

  it('sets a repository-local git identity when none is configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ userName: '', userEmail: '' });

    await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).toHaveBeenCalledWith('git', ['config', 'user.name', 'esl upload'], { cwd: skillDir });
    expect(execFileAsync).toHaveBeenCalledWith('git', ['config', 'user.email', 'esl@local'], { cwd: skillDir });
  });

  it('uses the --message text as the auto-commit message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ dirty: ' M SKILL.md\n' });

    await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      message: 'fix: correct the dead-link regex',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'fix: correct the dead-link regex'],
      { cwd: skillDir }
    );
  });

  it('reports already up to date instead of pushing when local HEAD matches the server source', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ localHead: 'same-sha', remoteHead: 'same-sha' });

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(result.alreadyUpToDate).toBe(true);
    expect(execFileAsync).not.toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('rebases local commits onto the server source before pushing when behind', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ behind: 2 });

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(execFileAsync).toHaveBeenCalledWith('git', ['rebase', 'esl/main'], { cwd: skillDir });
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('stops with clear guidance when the auto-rebase hits a conflict', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ behind: 1, rebaseConflict: true });

    await expect(
      executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/resolve them, then re-run "esl upload"/);
    expect(execFileAsync).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['push']),
      { cwd: skillDir }
    );
  });

  it('continues an in-progress rebase instead of creating a new commit', async () => {
    fs.mkdirSync(path.join(skillDir, '.git', 'rebase-merge'), { recursive: true });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({});

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(execFileAsync).toHaveBeenCalledWith('git', ['add', '-A'], { cwd: skillDir });
    expect(execFileAsync).toHaveBeenCalledWith('git', ['rebase', '--continue'], { cwd: skillDir });
  });

  it('fails with cross-account guidance when the fetch cannot access the hosted source', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return Promise.resolve({ stdout: 'http://localhost:3000/git/platform-ai/reviewer.git\n', stderr: '' });
      }
      if (args.includes('fetch')) {
        return Promise.reject(new Error('remote: Repository not found.'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const error = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/maintained by another account or organization/);
    expect(error!.message).toMatch(/git remote remove esl/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
  });

  it('fails with cross-account guidance and a push-finish hint when the push reports the hosted source is gone', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return Promise.resolve({ stdout: 'http://localhost:3000/git/platform-ai/reviewer.git\n', stderr: '' });
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return Promise.resolve({ stdout: 'local\n', stderr: '' });
      if (args[0] === 'rev-parse' && args.includes('--verify')) return Promise.resolve({ stdout: 'remote\n', stderr: '' });
      if (args[0] === 'rev-list') return Promise.resolve({ stdout: '0\n', stderr: '' });
      if (args.includes('push')) {
        return Promise.reject(new Error('fatal: repository not found'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const error = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/maintained by another account or organization/);
    expect(error!.message).toMatch(/git remote remove esl/);
    expect(error!.message).toMatch(/git push esl HEAD:main/);
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
  });

  it('hard-fails under --no-input when the hosted source cannot be accessed', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return Promise.resolve({ stdout: 'http://localhost:3000/git/platform-ai/reviewer.git\n', stderr: '' });
      }
      if (args.includes('fetch')) {
        return Promise.reject(new Error('remote: Repository not found.'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    await expect(
      executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/maintained by another account or organization/);
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
  });
});