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
        schemaVersion: 2,
        version: '0.1.0',
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
      fetchFail?: boolean;
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
      remoteUrl = 'http://localhost:3000/git/platform-ai/reviewer.git',
      fetchFail = false
    } = opts;
    return vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        if (remoteUrl === null) return Promise.reject(new Error('no such remote'));
        return Promise.resolve({ stdout: `${remoteUrl}\n`, stderr: '' });
      }
      if (args.includes('fetch')) {
        if (fetchFail) return Promise.reject(new Error('fatal: could not read Username for https://esl'));
        return Promise.resolve({ stdout: '', stderr: '' });
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
      schemaVersion: 2,
      version: '0.1.0',
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

  it('defaults to MIT when release.json is missing and no license is passed', async () => {
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
      noInput: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    const created = JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'));
    expect(created).toEqual({
      schemaVersion: 2,
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });
    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
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
    expect(fetchImpl).not.toHaveBeenCalledWith('http://localhost:3000/api/skills/upload', expect.anything());
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

  it('does not duplicate the guidance paragraph when syncing an inaccessible source fails', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = gitMock({ fetchFail: true });

    let captured: unknown;
    try {
      await executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      });
    } catch (error) {
      captured = error;
    }

    const message = (captured as Error).message;
    const guidance = 'Failed to sync the skill source with the server';
    expect(message).toMatch(new RegExp(guidance));
    // syncSource 已按 ADR-0021 包裹指导,调用方不得再包一层(双重包裹会重复段落)
    expect(message.match(new RegExp(guidance, 'g'))).toHaveLength(1);
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
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('updates the skill description through the dedicated endpoint when syncing an existing source', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/skills/%40platform-ai/reviewer/description')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ name: '@platform-ai/reviewer', description: 'Updated description' })
        });
      }
      return Promise.resolve({ ok: true, json: async () => uploadResponse });
    });
    const execFileAsync = gitMock({});

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40platform-ai/reviewer/description',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ description: 'Shared reviewer' })
      })
    );
  });

  it('does not block the source sync when the description update fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/description')) {
        return Promise.resolve({ ok: false, status: 403, text: async () => 'forbidden' });
      }
      return Promise.resolve({ ok: true, json: async () => uploadResponse });
    });
    const execFileAsync = gitMock({});

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/reviewer' });
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rejected the description update (403)')
    );
    warnSpy.mockRestore();
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

  it('falls back to the logged-in identity so commits match the Gitea account', async () => {
    await saveConfig({ username: 'author01', org: 'esl' }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => uploadResponse });
    const execFileAsync = gitMock({ userName: '', userEmail: '' });

    await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(execFileAsync).toHaveBeenCalledWith('git', ['config', 'user.name', 'esl_author01'], { cwd: skillDir });
    expect(execFileAsync).toHaveBeenCalledWith('git', ['config', 'user.email', 'esl_author01@local.esl'], { cwd: skillDir });
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

  it('falls back to unified guidance when the probe itself cannot resolve the identity', async () => {
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
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
  });

  it('reports a stale remote path when the probe shows the identity under a different clone URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ...uploadResponse,
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer-renamed.git'
      })
    });
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
    expect(error!.message).toMatch(/stale remote path|clone URL for @platform-ai\/reviewer/);
    expect(error!.message).toMatch(/reviewer-renamed/);
    expect(execFileAsync).not.toHaveBeenCalledWith('git', ['remote', 'remove', 'esl'], { cwd: skillDir });
  });

  it('reports a git access problem when the probe shows the identity at the same clone URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => uploadResponse
    });
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
    expect(error!.message).toMatch(/skill identity @platform-ai\/reviewer exists on the server/);
    expect(error!.message).toMatch(/stale credential or missing repository access|Log in with the maintaining account/);
    expect(error!.message).not.toMatch(/or it may no longer exist/);
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

  it('rehomes the esl remote when the server origin migrated and the identity verifies', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/skills/%40platform-ai%2Freviewer')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            name: '@platform-ai/reviewer',
            skillId: 'sk_01J00000000000000000000000',
            cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const execFileAsync = gitMock({ remoteUrl: 'http://old-host:3000/git/platform-ai/reviewer.git' });

    try {
      const result = await executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      });

      expect(result).toMatchObject({
        name: '@platform-ai/reviewer',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      });
      expect(execFileAsync).toHaveBeenCalledWith(
        'git',
        ['remote', 'set-url', 'esl', 'http://localhost:3000/git/platform-ai/reviewer.git'],
        { cwd: skillDir }
      );
      expect(fetchImpl).not.toHaveBeenCalledWith('http://localhost:3000/api/skills/upload', expect.anything());
      expect(execFileAsync).toHaveBeenCalledWith(
        'git',
        ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
        { cwd: skillDir }
      );
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('re-homed the esl remote'));
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('fails with migration guidance when the drifted source identity cannot be verified', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/skills/%40platform-ai%2Freviewer')) {
        return Promise.resolve({ ok: false, status: 404, text: async () => 'Skill not found' });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const execFileAsync = gitMock({ remoteUrl: 'http://old-host:3000/git/platform-ai/reviewer.git' });

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
    expect(error!.message).toMatch(/server origin migration/);
    expect(error!.message).toMatch(/git remote remove esl/);
    expect(execFileAsync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['set-url']), { cwd: skillDir });
    expect(execFileAsync).not.toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('rehomes through a rename redirect to the current source repository', async () => {
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: review-crew\ndescription: Shared reviewer\n---\n'
    );
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/skills/%40platform-ai%2Freviewer')) {
        return Promise.resolve({
          ok: true,
          status: 301,
          json: async () => ({
            error: 'Skill renamed',
            oldName: '@platform-ai/reviewer',
            currentName: '@platform-ai/review-crew',
            skillId: 'sk_01J00000000000000000000000'
          })
        });
      }
      if (url.includes('/api/skills/%40platform-ai%2Freview-crew')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            name: '@platform-ai/review-crew',
            cloneUrl: 'http://localhost:3000/git/platform-ai/review-crew.git'
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const execFileAsync = gitMock({ remoteUrl: 'http://old-host:3000/git/platform-ai/reviewer.git' });

    const result = await executeUpload({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({ name: '@platform-ai/review-crew' });
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['remote', 'set-url', 'esl', 'http://localhost:3000/git/platform-ai/review-crew.git'],
      { cwd: skillDir }
    );
  });
});