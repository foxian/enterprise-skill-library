import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executePublish } from '../src/commands/publish.js';

const SKILL_NAME = '@platform-ai/code-review';
const REMOTE_URL = 'http://localhost:3000/git/platform-ai/code-review.git';
const HEAD = 'abc123';

interface GitMockOptions {
  /** Working tree porcelain output; non-empty means a dirty tree. */
  status?: string;
  /** Local HEAD commit. */
  head?: string;
  /** Commit that `esl/main` points at. */
  remoteHead?: string;
  /** `esl` remote URL; null simulates a missing remote. */
  remoteUrl?: string | null;
  /** Commit the `v<version>` tag points at; null simulates a missing tag. */
  tagCommit?: string | null;
  /** Output of `git describe --tags --abbrev=0`. */
  describe?: string;
  /** Output of `git log`. */
  log?: string;
  /** Commits the local branch is ahead of esl/main by. */
  aheadCount?: number;
  /** Commits the local branch is behind esl/main by. */
  behindCount?: number;
  /** When set, `git fetch esl` fails with this message. */
  fetchFailure?: string | null;
  /** When set, `git rebase esl/main` fails with this message (a content conflict). */
  rebaseFailure?: string | null;
}

/**
 * Standard git double for publish tests. Every command the release flow can
 * reach has a handler, so a test only states the differences it cares about.
 */
function createGitMock(options: GitMockOptions = {}) {
  const {
    status = '',
    head = HEAD,
    remoteHead = HEAD,
    remoteUrl = REMOTE_URL,
    tagCommit = HEAD,
    describe = '',
    log = '',
    aheadCount = 0,
    behindCount = 0,
    fetchFailure = null,
    rebaseFailure = null
  } = options;

  return vi.fn().mockImplementation(async (_file: string, rawArgs: string[]) => {
    // Git auth is passed as `git -c <header> <command>`; strip it so the
    // handlers below only ever see the command itself.
    const args = rawArgs[0] === '-c' ? rawArgs.slice(2) : rawArgs;
    if (args[0] === 'status') return { stdout: status, stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: `${head}\n`, stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === 'esl/main') return { stdout: `${remoteHead}\n`, stderr: '' };
    if (args[0] === 'remote' && args[1] === 'get-url') {
      if (remoteUrl === null) throw new Error('error: No such remote: esl');
      return { stdout: `${remoteUrl}\n`, stderr: '' };
    }
    if (args[0] === 'fetch') {
      if (fetchFailure !== null) throw new Error(fetchFailure);
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-list' && args[1] === '--count') {
      return args.includes('HEAD..esl/main')
        ? { stdout: `${behindCount}\n`, stderr: '' }
        : { stdout: `${aheadCount}\n`, stderr: '' };
    }
    if (args[0] === 'rev-list' && args[1] === '-n') {
      if (tagCommit === null) {
        throw new Error(
          `fatal: ambiguous argument '${args[3]}': unknown revision or path not in the working tree.`
        );
      }
      return { stdout: `${tagCommit}\n`, stderr: '' };
    }
    if (args[0] === 'rebase') {
      if (rebaseFailure !== null) throw new Error(rebaseFailure);
      return { stdout: '', stderr: '' };
    }
    if (args.includes('push')) return { stdout: '', stderr: '' };
    if (args[0] === 'describe') return { stdout: describe, stderr: '' };
    if (args[0] === 'log') return { stdout: log, stderr: '' };
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  });
}

/** The release-creating POSTs a fetch double received, ignoring read-only lookups. */
function releasePosts(fetchImpl: any): [string][] {
  return (fetchImpl.mock.calls as [string][]).filter(([url]) => String(url).includes('/releases'));
}

function createFetchMock(release: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      name: SKILL_NAME,
      version: '1.0.0',
      sourceCommit: HEAD,
      packageUrl: '/api/packages/sk_123/1.0.0/sha.json',
      ...release
    })
  });
}

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
        schemaVersion: 2,
        version: '1.0.0',
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

  it('reads the released version from release.json', async () => {
    const fetchImpl = createFetchMock();

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: createGitMock() as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:3000/api/skills/${encodeURIComponent(SKILL_NAME)}/releases`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"version":"1.0.0"')
      })
    );
  });

  it('rejects an explicit version argument and points at esl version', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        version: '2.0.0',
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/esl version/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('creates a minimal release.json when missing and guides the user to set a version', async () => {
    fs.rmSync(path.join(skillDir, 'release.json'));
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        license: 'Apache-2.0',
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/esl version/);

    const created = JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'));
    expect(created).toEqual({
      schemaVersion: 2,
      version: '0.1.0',
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
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/esl version/);

    const created = JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'));
    expect(created).toEqual({
      schemaVersion: 2,
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('publishes a release manifest from a clean HEAD already on esl/main without pushing source', async () => {
    const fetchImpl = createFetchMock();
    const execFileAsync = createGitMock();

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:3000/api/skills/${encodeURIComponent(SKILL_NAME)}/releases`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(`"sourceCommit":"${HEAD}"`)
      })
    );
    expect((execFileAsync.mock.calls as [string, string[]][]).some(([, args]) => args.includes('push'))).toBe(false);
  });

  it('rejects a dirty release worktree before calling the server', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock({ status: ' M SKILL.md\n' }) as any
      })
    ).rejects.toThrow('working tree is not clean');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a release whose version has no tag on HEAD', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock({ tagCommit: null }) as any
      })
    ).rejects.toThrow(/v1\.0\.0/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a tag that points at a different commit than HEAD', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock({ tagCommit: 'def456' }) as any
      })
    ).rejects.toThrow(/different commit/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('guides the user to esl upload when the directory has no esl remote', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock({ remoteUrl: null }) as any
      })
    ).rejects.toThrow('no esl remote; run esl upload first');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a source whose esl remote infers a local namespace', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock({ remoteUrl: 'http://localhost:3000/git/local/code-review.git' }) as any
      })
    ).rejects.toThrow('@local/* skills use the local namespace and must be renamed to a stable namespace');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pushes local commits that are ahead of esl/main before releasing', async () => {
    const fetchImpl = createFetchMock();
    const execFileAsync = createGitMock({ remoteHead: 'def456', aheadCount: 2, behindCount: 0 });

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    const calls = execFileAsync.mock.calls as [string, string[]][];
    expect(calls.some(([, args]) => args.includes('fetch'))).toBe(true);
    expect(calls.some(([, args]) => args.includes('push'))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rebases onto esl/main before pushing when the server source has newer commits', async () => {
    const fetchImpl = createFetchMock();
    const execFileAsync = createGitMock({ remoteHead: 'def456', aheadCount: 1, behindCount: 3 });

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    const calls = execFileAsync.mock.calls as [string, string[]][];
    const rebaseIndex = calls.findIndex(([, args]) => args[0] === 'rebase');
    const pushIndex = calls.findIndex(([, args]) => args.includes('push'));
    expect(rebaseIndex).toBeGreaterThanOrEqual(0);
    expect(pushIndex).toBeGreaterThan(rebaseIndex);
  });

  it('leaves a conflicted rebase in place and asks the user to resolve it', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = createGitMock({
      remoteHead: 'def456',
      behindCount: 1,
      rebaseFailure: 'CONFLICT (content): Merge conflict in SKILL.md'
    });

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow(/conflict/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('validates and previews the release in --dry-run without touching the server', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = createGitMock();

    const result = await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      dryRun: true,
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any
    });

    expect(result).toMatchObject({
      dryRun: true,
      name: SKILL_NAME,
      version: '1.0.0',
      sourceCommit: HEAD
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((execFileAsync.mock.calls as [string, string[]][]).some(([, args]) => args.includes('push'))).toBe(false);
  });

  it('still rejects invalid releases in --dry-run', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        force: true,
        dryRun: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock({ status: ' M SKILL.md\n' }) as any
      })
    ).rejects.toThrow('working tree is not clean');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a version lower than the highest published one', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/releases')) {
        return { ok: true, json: async () => ({ name: SKILL_NAME, version: '1.0.0' }) };
      }
      return { ok: true, json: async () => ({ name: SKILL_NAME, versions: ['1.2.0', '1.0.0'] }) };
    });

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock() as any
      })
    ).rejects.toThrow(/1\.2\.0/);

    const posts = (fetchImpl.mock.calls as [string][]).filter(([url]) => String(url).includes('/releases'));
    expect(posts).toHaveLength(0);
  });

  it('publishes a lower version when --force bypasses the check', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/releases')) {
        return { ok: true, json: async () => ({ name: SKILL_NAME, version: '1.0.0' }) };
      }
      return { ok: true, json: async () => ({ name: SKILL_NAME, versions: ['1.2.0'] }) };
    });

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: createGitMock() as any
    });

    const posts = (fetchImpl.mock.calls as [string][]).filter(([url]) => String(url).includes('/releases'));
    expect(posts).toHaveLength(1);
  });

  it('prompts for confirmation before publishing', async () => {
    const fetchImpl = createFetchMock();
    const confirmInput = vi.fn().mockResolvedValue(true);

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      confirmInput,
      customFetch: fetchImpl as any,
      execFileAsync: createGitMock() as any
    });

    expect(confirmInput).toHaveBeenCalledTimes(1);
    expect(releasePosts(fetchImpl)).toHaveLength(1);
  });

  it('cancels when confirmation is declined', async () => {
    const fetchImpl = vi.fn();
    const confirmInput = vi.fn().mockResolvedValue(false);
    const execFileAsync = createGitMock();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        confirmInput,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any
      })
    ).rejects.toThrow('Publish cancelled');

    expect(releasePosts(fetchImpl)).toHaveLength(0);
    expect((execFileAsync.mock.calls as [string, string[]][]).some(([, args]) => args.includes('push'))).toBe(false);
  });

  it('sends the --message text as the release notes', async () => {
    const fetchImpl = createFetchMock();

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      message: 'fix: dead-link regex',
      customFetch: fetchImpl as any,
      execFileAsync: createGitMock() as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({ body: expect.stringContaining('"notes":"fix: dead-link regex"') })
    );
  });

  it('auto-collects the commit messages since the last release tag as the notes', async () => {
    const fetchImpl = createFetchMock();

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      customFetch: fetchImpl as any,
      execFileAsync: createGitMock({
        describe: 'v1.0.0\n',
        log: 'fix: dead-link regex\nfeat: docx batch\n'
      }) as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({
        body: expect.stringContaining('"notes":"- fix: dead-link regex\\n- feat: docx batch"')
      })
    );
  });

  it('lets an interactive note input override the collected notes', async () => {
    const fetchImpl = createFetchMock();

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      noteInput: async () => 'custom manual note',
      customFetch: fetchImpl as any,
      execFileAsync: createGitMock({ describe: 'v1.0.0\n', log: 'fix: dead-link regex\n' }) as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({ body: expect.stringContaining('"notes":"custom manual note"') })
    );
  });

  it('falls back to the collected notes when the note input is empty', async () => {
    const fetchImpl = createFetchMock();

    await executePublish({
      directory: skillDir,
      server: 'http://localhost:3000',
      homeDir,
      force: true,
      noteInput: async () => '',
      customFetch: fetchImpl as any,
      execFileAsync: createGitMock({ describe: 'v1.0.0\n', log: 'fix: dead-link regex\n' }) as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.objectContaining({ body: expect.stringContaining('"notes":"- fix: dead-link regex"') })
    );
  });

  it('fails fast when --no-input is set without --force', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        server: 'http://localhost:3000',
        homeDir,
        noInput: true,
        customFetch: fetchImpl as any,
        execFileAsync: createGitMock() as any
      })
    ).rejects.toThrow('Publishing requires confirmation; pass --force to skip it');

    expect(releasePosts(fetchImpl)).toHaveLength(0);
  });
});
