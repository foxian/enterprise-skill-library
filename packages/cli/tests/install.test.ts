import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeInstall } from '../src/commands/install.js';

describe('esl install (global mode)', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-install-home-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('clones a scoped skill into the scoped global path with --global', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    let notified = false;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      if (typeof chunk === 'string' && chunk.includes('Cloning')) {
        notified = true;
      }
      return true;
    });

    try {
      await executeInstall('@alice/code-review', {
        homeDir,
        global: true,
        noAdapt: true,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      });
    } finally {
      stderrSpy.mockRestore();
    }

    expect(notified).toBe(true);
    expect(execFileAsync).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        '-c',
        'http.extraHeader=Authorization: Bearer gitea-token',
        'clone',
        'http://localhost:3000/git/esl-skills/alice_code-review.git',
        path.join(homeDir, '.skill-library', 'skills', '@alice', 'code-review')
      ]
    );
  });

  it('installs a Published Skill Package without cloning the source repository', async () => {
    const packageBytes = Buffer.from(JSON.stringify({
      name: '@platform-ai/reviewer',
      skillId: 'sk_01J00000000000000000000000',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      },
      files: {
        'SKILL.md': '---\nname: platform-ai:reviewer\ndescription: Review code\n---\n\n# Reviewer\n',
        'skill.json': '{\n  "name": "@platform-ai/reviewer",\n  "version": "1.0.0"\n}\n'
      }
    }));
    const packageChecksum = `sha256-${crypto.createHash('sha256').update(packageBytes).digest('hex')}`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/reviewer',
          skillId: 'sk_01J00000000000000000000000',
          versions: ['1.0.0'],
          packageUrl: `/api/packages/sk_01J00000000000000000000000/1.0.0/${packageChecksum}.json`
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => packageBytes
      });
    const execFileAsync = vi.fn();

    const target = await executeInstall('@platform-ai/reviewer', {
      homeDir,
      global: true,
      noAdapt: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(target).toContain('platform-ai_reviewer');
    expect(fs.existsSync(path.join(target, 'skill.json'))).toBe(true);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toContain('name: platform-ai:reviewer');
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('rejects a package whose bytes do not match the Registry checksum before installation', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/reviewer',
          skillId: 'sk_01J00000000000000000000000',
          versions: ['1.0.0'],
          packageUrl: '/api/packages/sk_01J00000000000000000000000/1.0.0/sha256-expected.json'
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from('tampered')
      });

    await expect(executeInstall('@platform-ai/reviewer', {
      homeDir,
      global: true,
      noAdapt: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    })).rejects.toThrow('checksum does not match');
    expect(fs.existsSync(path.join(homeDir, '.skill-library', 'skills', 'platform-ai_reviewer'))).toBe(false);
  });

  it('rejects an incompatible package unless compatibility checks are ignored', async () => {
    const packageBytes = Buffer.from(JSON.stringify({
      name: '@platform-ai/reviewer',
      skillId: 'sk_01J00000000000000000000000',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: { tools: ['missing-tool'] },
        dependencies: {}
      },
      files: {
        'SKILL.md': '---\nname: platform-ai:reviewer\ndescription: Review code\n---\n',
        'skill.json': '{\n  "name": "@platform-ai/reviewer",\n  "version": "1.0.0"\n}\n'
      }
    }));
    const checksum = `sha256-${crypto.createHash('sha256').update(packageBytes).digest('hex')}`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/reviewer',
          skillId: 'sk_01J00000000000000000000000',
          versions: ['1.0.0'],
          packageUrl: `/api/packages/sk_01J00000000000000000000000/1.0.0/${checksum}.json`
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => packageBytes
      });
    const execFileAsync = vi.fn().mockRejectedValue(new Error('missing-tool not found'));

    await expect(executeInstall('@platform-ai/reviewer', {
      homeDir,
      global: true,
      noAdapt: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    })).rejects.toThrow('incompatible');

    fetchImpl.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: '@platform-ai/reviewer',
        skillId: 'sk_01J00000000000000000000000',
        versions: ['1.0.0'],
        packageUrl: `/api/packages/sk_01J00000000000000000000000/1.0.0/${checksum}.json`
      })
    });
    fetchImpl.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => packageBytes
    });

    const target = await executeInstall('@platform-ai/reviewer', {
      homeDir,
      global: true,
      noAdapt: true,
      ignoreCompatibility: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });
    expect(fs.existsSync(path.join(target, 'SKILL.md'))).toBe(true);
  });
});
