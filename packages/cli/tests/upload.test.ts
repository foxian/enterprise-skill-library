import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
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

  it('creates a minimal release.json when missing and guides the user to commit before uploading', async () => {
    fs.rmSync(path.join(skillDir, 'release.json'));
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeUpload({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        license: 'Apache-2.0',
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
});