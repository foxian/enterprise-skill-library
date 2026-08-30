import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeStatus } from '../src/commands/status.js';

describe('esl status', () => {
  let tmpRoot: string;
  let skillDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-status-'));
    skillDir = path.join(tmpRoot, 'reviewer');
    fs.mkdirSync(skillDir);
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-status-home-'));
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
      hasRemote?: boolean;
      dirty?: string;
      ahead?: number;
      behind?: number;
      lastCommit?: string;
    } = {}
  ) {
    const { inRepo = true, hasRemote = true, dirty = '', ahead = 0, behind = 0, lastCommit = 'abc123 fix: something' } = opts;
    return vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('--is-inside-work-tree')) {
        return inRepo ? Promise.resolve({ stdout: 'true\n', stderr: '' }) : Promise.reject(new Error('not a repo'));
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return hasRemote
          ? Promise.resolve({ stdout: 'http://localhost:3000/git/org/reviewer.git\n', stderr: '' })
          : Promise.reject(new Error('no such remote'));
      }
      if (args[0] === 'status') {
        return Promise.resolve({ stdout: dirty, stderr: '' });
      }
      if (args[0] === 'rev-list') {
        if (args.includes('HEAD..esl/main')) return Promise.resolve({ stdout: `${behind}\n`, stderr: '' });
        return Promise.resolve({ stdout: `${ahead}\n`, stderr: '' });
      }
      if (args[0] === 'log') {
        return Promise.resolve({ stdout: `${lastCommit}\n`, stderr: '' });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });
  }

  it('reports a directory that is not a git repository as not server-hosted', async () => {
    const execFileAsync = gitMock({ inRepo: false });

    const status = await executeStatus({ directory: skillDir, homeDir, execFileAsync: execFileAsync as any });

    expect(status.serverHosted).toBe(false);
  });

  it('reports a repository without an esl remote as not server-hosted', async () => {
    const execFileAsync = gitMock({ hasRemote: false });

    const status = await executeStatus({ directory: skillDir, homeDir, execFileAsync: execFileAsync as any });

    expect(status.serverHosted).toBe(false);
  });

  it('reports a clean server-hosted source with nothing to push or pull', async () => {
    const execFileAsync = gitMock({});

    const status = await executeStatus({ directory: skillDir, homeDir, execFileAsync: execFileAsync as any });

    expect(status).toMatchObject({
      serverHosted: true,
      clean: true,
      ahead: 0,
      behind: 0,
      lastCommit: 'abc123 fix: something'
    });
  });

  it('reports uncommitted changes and ahead/behind counts against the server source', async () => {
    const execFileAsync = gitMock({ dirty: ' M SKILL.md\n', ahead: 2, behind: 1 });

    const status = await executeStatus({ directory: skillDir, homeDir, execFileAsync: execFileAsync as any });

    expect(status).toMatchObject({ serverHosted: true, clean: false, ahead: 2, behind: 1 });
  });
});
