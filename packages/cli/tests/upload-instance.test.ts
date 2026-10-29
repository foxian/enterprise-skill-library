import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';
import { executeUpload } from '../src/commands/upload.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';
const OLD_CLONE = 'http://old-host:3000/git/platform-ai/reviewer.git';
const NEW_CLONE = 'http://new-host:4070/git/platform-ai/reviewer.git';

describe('esl upload source remote continuity', () => {
  let root: string;
  let skillDir: string;
  let homeDir: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-upload-instance-'));
    skillDir = path.join(root, 'reviewer');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'release.json'),
      JSON.stringify({
        schemaVersion: 3,
        name: '@platform-ai/reviewer',
        version: '0.1.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: reviewer\ndescription: Shared reviewer\n---\n');
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-upload-instance-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ username: 'platform-ai', organizations: [] }, { homeDir });
    await saveCredentials({ token: 'token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function gitMock(recorded: { instanceId?: string; skillId?: string } = {}) {
    return vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return Promise.resolve({ stdout: `${OLD_CLONE}\n`, stderr: '' });
      }
      if (args[0] === 'config' && args[1] === 'esl.instanceId' && args.length === 2) {
        return recorded.instanceId
          ? Promise.resolve({ stdout: `${recorded.instanceId}\n`, stderr: '' })
          : Promise.resolve({ stdout: '', stderr: '' });
      }
      if (args[0] === 'config' && args[1] === 'esl.skillId' && args.length === 2) {
        return recorded.skillId
          ? Promise.resolve({ stdout: `${recorded.skillId}\n`, stderr: '' })
          : Promise.resolve({ stdout: '', stderr: '' });
      }
      if (args[0] === 'config' && args[1] === 'esl.repoPath' && args.length === 2) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (args[0] === 'rev-parse' && args.includes('--is-inside-work-tree')) {
        return Promise.resolve({ stdout: 'true\n', stderr: '' });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });
  }

  function infoFetch(instanceId: string, skillId = 'sk_01J00000000000000000000000') {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId,
        instanceId,
        cloneUrl: NEW_CLONE
      })
    });
  }

  async function runUpload(execFileAsync: ReturnType<typeof gitMock>, customFetch: unknown) {
    return executeUpload({
      directory: skillDir,
      server: 'http://new-host:4070',
      homeDir,
      customFetch: customFetch as any,
      execFileAsync: execFileAsync as any
    });
  }

  it('rehomes only the esl remote when the same instance is verified', async () => {
    const execFileAsync = gitMock({ instanceId: INSTANCE_A });
    const result = await runUpload(execFileAsync, infoFetch(INSTANCE_A));

    expect(result).toMatchObject({ instanceId: INSTANCE_A, cloneUrl: NEW_CLONE });
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      ['remote', 'set-url', 'esl', NEW_CLONE],
      { cwd: skillDir }
    );
    // 用户自己的 origin 不受影响：绝不执行 origin 的 remote 变更。
    const originCalls = execFileAsync.mock.calls.filter(
      (call) => call[0] === 'git' && call[1]?.[0] === 'remote' && call[1]?.includes('origin')
    );
    expect(originCalls).toHaveLength(0);
  });

  it('refuses to rehome across different instance IDs', async () => {
    const execFileAsync = gitMock({ instanceId: INSTANCE_A });
    await expect(runUpload(execFileAsync, infoFetch(INSTANCE_B))).rejects.toThrow(
      /Cross-instance source migration is not automatic/
    );
    expect(execFileAsync).not.toHaveBeenCalledWith(
      'git',
      ['remote', 'set-url', 'esl', NEW_CLONE],
      { cwd: skillDir }
    );
  });

  it('refuses to sync when a registered address rebinds to another instance', async () => {
    await saveConfig(
      {
        server: 'http://new-host:4070',
        selectedInstanceId: INSTANCE_A,
        servers: [
          {
            instanceId: INSTANCE_A,
            preferredAddress: 'http://new-host:4070',
            addresses: [
              { url: 'http://new-host:4070', confirmedAt: new Date().toISOString() }
            ]
          }
        ]
      },
      { homeDir }
    );
    const execFileAsync = gitMock();
    await expect(runUpload(execFileAsync, infoFetch(INSTANCE_B))).rejects.toThrow(
      /registered to ESL Server instance|silently rebound/
    );
    expect(execFileAsync).not.toHaveBeenCalledWith(
      'git',
      ['remote', 'set-url', 'esl', NEW_CLONE],
      { cwd: skillDir }
    );
  });

  it('refuses to rehome when the Skill ID does not match the source record', async () => {
    const execFileAsync = gitMock({ instanceId: INSTANCE_A, skillId: 'sk_original' });
    await expect(runUpload(execFileAsync, infoFetch(INSTANCE_A, 'sk_other'))).rejects.toThrow(
      /refusing to re-home the remote/
    );
    expect(execFileAsync).not.toHaveBeenCalledWith(
      'git',
      ['remote', 'set-url', 'esl', NEW_CLONE],
      { cwd: skillDir }
    );
  });
});
