import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { readCliVersion } from '../src/version.js';

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
        path.join(homeDir, '.eslib', 'skills', '@alice', 'code-review')
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
        schemaVersion: 2,
        version: '0.1.0',
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

    expect(target).toBe(
      path.join(homeDir, '.eslib', 'skills', '@platform-ai', 'reviewer')
    );
    expect(fs.existsSync(path.join(target, 'skill.json'))).toBe(true);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toContain('name: platform-ai:reviewer');
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('installs the highest stable release, not the most recently published one', async () => {
    const packageBytes = Buffer.from(JSON.stringify({
      name: '@platform-ai/reviewer',
      skillId: 'sk_01J00000000000000000000000',
      version: '1.2.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 2,
        version: '1.2.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      },
      files: {
        'SKILL.md': '---\nname: platform-ai:reviewer\ndescription: Review code\n---\n\n# Reviewer\n',
        'skill.json': '{\n  "name": "@platform-ai/reviewer",\n  "version": "1.2.0"\n}\n'
      }
    }));
    const packageChecksum = `sha256-${crypto.createHash('sha256').update(packageBytes).digest('hex')}`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/reviewer',
          skillId: 'sk_01J00000000000000000000000',
          // Newest published first: 0.1.0 was published after 1.2.0.
          versions: ['0.1.0', '1.2.0', '1.3.0-beta.1'],
          releases: [
            { version: '0.1.0', packageUrl: `/api/packages/sk_01J00000000000000000000000/0.1.0/stale.json` },
            {
              version: '1.2.0',
              packageUrl: `/api/packages/sk_01J00000000000000000000000/1.2.0/${packageChecksum}.json`
            }
          ],
          packageUrl: `/api/packages/sk_01J00000000000000000000000/0.1.0/stale.json`
        })
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => packageBytes });

    const target = await executeInstall('@platform-ai/reviewer', {
      homeDir,
      global: true,
      noAdapt: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: vi.fn() as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/1.2.0/'),
      expect.anything()
    );
    expect(JSON.parse(fs.readFileSync(path.join(target, 'skill.json'), 'utf8')).version).toBe('1.2.0');
  });

  it('warns about a deprecated release but installs it anyway', async () => {
    const packageBytes = Buffer.from(JSON.stringify({
      name: '@platform-ai/reviewer',
      skillId: 'sk_01J00000000000000000000000',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 2,
        version: '1.0.0',
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
          releases: [
            {
              version: '1.0.0',
              packageUrl: `/api/packages/sk_01J00000000000000000000000/1.0.0/${packageChecksum}.json`,
              deprecatedMessage: 'Use 1.1.0; this release ships a broken regex'
            }
          ]
        })
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => packageBytes });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const target = await executeInstall('@platform-ai/reviewer', {
      homeDir,
      global: true,
      noAdapt: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: vi.fn() as any
    });

    expect(target).toBe(
      path.join(homeDir, '.eslib', 'skills', '@platform-ai', 'reviewer')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Use 1.1.0; this release ships a broken regex'));
    warnSpy.mockRestore();
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
    expect(fs.existsSync(path.join(homeDir, '.eslib', 'skills', '@platform-ai', 'reviewer'))).toBe(false);
  });

  it('rejects an incompatible package unless compatibility checks are ignored', async () => {
    const packageBytes = Buffer.from(JSON.stringify({
      name: '@platform-ai/reviewer',
      skillId: 'sk_01J00000000000000000000000',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: {
        schemaVersion: 2,
        version: '0.1.0',
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

describe('esl install request reporting (#136)', () => {
  let homeDir: string;
  const server = 'http://localhost:3000';

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-install-report-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  // 期望的 User-Agent 精确格式：esl/<CLI 版本> node/<Node 版本> <platform>/<arch>。
  function expectedUserAgent(): string {
    return `esl/${readCliVersion()} node/${process.version.replace(/^v/, '')} ${process.platform}/${process.arch}`;
  }

  interface PackageSpec {
    name: string;
    skillId: string;
    version: string;
    dependencies?: Record<string, string>;
    dependencyLock?: Record<string, { skillId: string; version: string; checksum: string }>;
  }

  function buildPackage(spec: PackageSpec): { bytes: Buffer; checksum: string } {
    const bytes = Buffer.from(
      JSON.stringify({
        name: spec.name,
        skillId: spec.skillId,
        version: spec.version,
        sourceCommit: `${spec.skillId}-${spec.version}`,
        releaseManifest: { compatibility: {}, dependencies: spec.dependencies ?? {} },
        dependencyLock: spec.dependencyLock ?? {},
        files: {
          'SKILL.md': `---\nname: ${spec.name.replace('@', '').replace('/', ':')}\ndescription: x\n---\n`,
          'skill.json': JSON.stringify({ name: spec.name, version: spec.version, description: 'x', author: 'tester' })
        }
      })
    );
    return { bytes, checksum: `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}` };
  }

  function packageResponse(bytes: Buffer) {
    return { ok: true, arrayBuffer: async () => bytes };
  }

  function installOptions(customFetch: unknown) {
    return {
      homeDir,
      global: true,
      noAdapt: true,
      server,
      customFetch: customFetch as never,
      execFileAsync: vi.fn() as never
    };
  }

  it('sends the exact User-Agent alongside Authorization and ?requested=<version> on the root package request', async () => {
    const root = buildPackage({ name: '@platform-ai/reviewer', skillId: 'sk_r', version: '1.2.3' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/reviewer',
          skillId: 'sk_r',
          visibility: 'public',
          versions: ['1.2.3'],
          packageUrl: `/api/packages/sk_r/1.2.3/${root.checksum}.json`
        })
      })
      .mockResolvedValueOnce(packageResponse(root.bytes));

    await executeInstall('@platform-ai/reviewer', {
      ...installOptions(fetchImpl),
      version: '1.2.3'
    } as any);

    const packageCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).includes('/api/packages/')
    ) as [string, { headers: Record<string, string> }];
    expect(packageCall[0]).toBe(
      `${server}/api/packages/sk_r/1.2.3/${root.checksum}.json?requested=1.2.3`
    );
    expect(packageCall[1].headers['User-Agent']).toBe(expectedUserAgent());
    expect(packageCall[1].headers.Authorization).toBe('token gitea-token');
  });

  it('reports "latest" on the root package request when no version specifier is given', async () => {
    const root = buildPackage({ name: '@platform-ai/reviewer', skillId: 'sk_r', version: '1.0.0' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/reviewer',
          skillId: 'sk_r',
          visibility: 'public',
          versions: ['1.0.0'],
          packageUrl: `/api/packages/sk_r/1.0.0/${root.checksum}.json`
        })
      })
      .mockResolvedValueOnce(packageResponse(root.bytes));

    await executeInstall('@platform-ai/reviewer', installOptions(fetchImpl) as any);

    const packageCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).includes('/api/packages/')
    ) as [string, { headers: Record<string, string> }];
    expect(packageCall[0]).toBe(
      `${server}/api/packages/sk_r/1.0.0/${root.checksum}.json?requested=latest`
    );
    expect(packageCall[1].headers['User-Agent']).toBe(expectedUserAgent());
  });

  it('reports the locked exact version on a dependency package request', async () => {
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const root = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: {
        '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum }
      }
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/root-a',
          skillId: 'sk_a',
          visibility: 'public',
          versions: ['1.0.0'],
          packageUrl: `/api/packages/sk_a/1.0.0/${root.checksum}.json`
        })
      })
      .mockResolvedValueOnce(packageResponse(root.bytes))
      .mockResolvedValueOnce(packageResponse(shared.bytes))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: '@platform-ai/shared', visibility: 'public', versions: ['1.2.0'] })
      });

    await executeInstall('@platform-ai/root-a', installOptions(fetchImpl) as any);

    const dependencyCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).includes('/api/packages/sk_shared/')
    ) as [string, { headers: Record<string, string> }];
    expect(dependencyCall[0]).toBe(
      `${server}/api/packages/sk_shared/1.2.0/${shared.checksum}.json?requested=1.2.0`
    );
    expect(dependencyCall[1].headers['User-Agent']).toBe(expectedUserAgent());
    // 根包仍按用户 specifier（未显式给出时 latest）上报。
    const rootCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).includes('/api/packages/sk_a/')
    ) as [string, unknown];
    expect(rootCall[0]).toBe(`${server}/api/packages/sk_a/1.0.0/${root.checksum}.json?requested=latest`);
  });
});
