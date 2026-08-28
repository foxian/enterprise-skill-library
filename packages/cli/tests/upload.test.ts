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

  function gitMock(opts: { inRepo?: boolean; dirty?: string; userName?: string; userEmail?: string } = {}) {
    const { inRepo = true, dirty = '', userName = '', userEmail = '' } = opts;
    return vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) {
        if (inRepo) return Promise.resolve({ stdout: 'true\n', stderr: '' });
        return Promise.reject(new Error('fatal: not a git repository'));
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
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

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

  it('resumes an interrupted upload when the esl remote already points at the server source', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'add') {
        return Promise.reject(new Error('fatal: remote esl already exists.'));
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return Promise.resolve({ stdout: 'http://localhost:3000/git/platform-ai/reviewer.git\n', stderr: '' });
      }
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
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['-c', 'http.extraHeader=Authorization: Bearer token', 'push', 'esl', 'HEAD:main'],
      { cwd: skillDir }
    );
  });

  it('fails with recovery guidance when the esl remote points at a different source', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        cloneUrl: 'http://localhost:3000/git/platform-ai/reviewer.git'
      })
    });
    const execFileAsync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'add') {
        return Promise.reject(new Error('fatal: remote esl already exists.'));
      }
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
    ).rejects.toThrow(/git remote remove esl/);
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
    const execFileAsync = gitMock({ inRepo: false });

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
});