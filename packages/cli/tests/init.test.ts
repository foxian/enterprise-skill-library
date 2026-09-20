import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInit } from '../src/index.js';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';

describe('esl init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const skillPath = (name = 'my-skill') => path.join(tmpDir, name);

  it('fills in an existing directory in place, named after the directory', async () => {
    // 隔离本地存储:登录态存在时会改写默认归属(@用户名/技能名)
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-home-'));
    const targetDir = await executeInit({ directory: skillPath(), runGitInit: false, homeDir: homeDir });
    fs.rmSync(homeDir, { recursive: true, force: true });

    expect(targetDir).toBe(skillPath());
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'release.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'skill.json'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'scripts'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'references'))).toBe(false);

    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson).toEqual({
      schemaVersion: 3,
      name: 'my-skill',
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });

    const skillMd = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: my-skill');
    expect(skillMd).toContain('description: Use when');
  });

  it('writes the bare short name by default when logged in', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ username: 'alice', organizations: [] }, { homeDir });

    try {
      await executeInit({ directory: skillPath(), runGitInit: false, homeDir });

      const releaseJson = JSON.parse(fs.readFileSync(path.join(skillPath(), 'release.json'), 'utf8'));
      expect(releaseJson.name).toBe('my-skill');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('writes an organization namespace passed explicitly', async () => {
    const targetDir = await executeInit({
      directory: skillPath(),
      name: 'my-skill',
      namespace: 'acme',
      runGitInit: false
    });

    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.name).toBe('@acme/my-skill');
  });

  it('asks for the namespace when creating release.json interactively', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-home-'));
    await initializeLocalStore({ homeDir });

    try {
      const asked: string[] = [];
      const targetDir = await executeInit({
        directory: skillPath(),
        runGitInit: false,
        homeDir,
        promptText: async (question, fallback) => {
          asked.push(question);
          if (question.includes('Namespace')) return 'acme';
          return fallback;
        }
      });

      expect(asked.some((question) => question.includes('Namespace'))).toBe(true);
      const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
      expect(releaseJson.name).toBe('@acme/my-skill');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('shows a namespace menu fetched from the server', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://localhost:3000', username: 'alice', organizations: [] }, { homeDir });
    await saveCredentials({ token: 'token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organizations: [
          { org: 'acme', identity: 'owner', isOwnerMember: true },
          { org: 'beta', identity: 'ordinary', isOwnerMember: false }
        ],
        pendingApplications: []
      })
    });

    try {
      const targetDir = await executeInit({
        directory: skillPath(),
        runGitInit: false,
        homeDir,
        customFetch: fetchImpl as any,
        promptText: async (question, fallback) => (question === 'Select namespace [1]: ' ? '2' : fallback)
      });

      expect(fetchImpl).toHaveBeenCalledWith(
        'http://localhost:3000/api/orgs/mine',
        expect.objectContaining({ headers: { Authorization: 'token token' } })
      );
      const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
      expect(releaseJson.name).toBe('@acme/my-skill');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('falls back to the cached organization list when the server cannot be reached', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        server: 'http://localhost:3000',
        username: 'alice',
        organizations: [{ org: 'cached-org', identity: 'member', isOwnerMember: false }]
      },
      { homeDir }
    );
    await saveCredentials({ token: 'token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    let namespaceQuestion = '';

    try {
      const targetDir = await executeInit({
        directory: skillPath(),
        runGitInit: false,
        homeDir,
        customFetch: fetchImpl as any,
        promptText: async (question, fallback) => {
          if (question === 'Select namespace [1]: ') {
            namespaceQuestion = question;
            return '1';
          }
          return fallback;
        }
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(namespaceQuestion).toBe('Select namespace [1]: ');
      const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
      expect(releaseJson.name).toBe('my-skill');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('honors --name for a generated SKILL.md', async () => {
    const targetDir = await executeInit({ directory: skillPath(), name: 'renamed-skill', runGitInit: false });

    expect(targetDir).toBe(skillPath());
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('name: renamed-skill');
  });

  it('rejects an invalid generated name', async () => {
    await expect(executeInit({ directory: skillPath('Bad Name'), runGitInit: false })).rejects.toThrow(
      'lowercase letters, digits, and hyphens'
    );
  });

  it('never overwrites an existing valid SKILL.md or release.json', async () => {
    const targetDir = skillPath();
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), '---\nname: existing\ndescription: Original.\n---\n');
    fs.writeFileSync(
      path.join(targetDir, 'release.json'),
      JSON.stringify({ schemaVersion: 2, version: '1.2.3', license: 'Apache-2.0', keywords: ['x'], compatibility: {}, dependencies: {} })
    );

    const result = await executeInit({ directory: targetDir, name: 'renamed-skill', runGitInit: false });

    expect(result).toBe(targetDir);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('name: existing');
    expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8')).version).toBe('1.2.3');
  });

  it('adopts an already-existing skill name from SKILL.md and warns about --name conflicts', async () => {
    const targetDir = skillPath();
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'SKILL.md'),
      '---\nname: existing\ndescription: Original.\n---\nAdditional content kept.\n'
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let warnedConflict = false;
    try {
      await executeInit({ directory: targetDir, name: 'renamed-skill', runGitInit: false });
      warnedConflict = stderrSpy.mock.calls.some((args) => String(args[0]).includes('declares the name existing'));
    } finally {
      stderrSpy.mockRestore();
    }

    const skillMd = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: existing');
    expect(skillMd).toContain('Additional content kept.');
    expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8')).version).toBe('0.1.0');
    expect(warnedConflict).toBe(true);
  });

  it('fills only release.json and warns when SKILL.md exists but is not valid', async () => {
    const targetDir = skillPath();
    fs.mkdirSync(targetDir, { recursive: true });
    const original = '---\nname: my-skill\n---\n# Content\n';
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), original);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let warnedInvalid = false;
    try {
      await executeInit({ directory: targetDir, runGitInit: false });
      warnedInvalid = stderrSpy.mock.calls.some((args) => String(args[0]).includes('not a valid ESL skill source'));
    } finally {
      stderrSpy.mockRestore();
    }

    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe(original);
    expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'))).toMatchObject({
      schemaVersion: 3,
      version: '0.1.0'
    });
    expect(warnedInvalid).toBe(true);
  });

  it('accepts extra frontmatter fields without warning or rewriting SKILL.md', async () => {
    const targetDir = skillPath();
    fs.mkdirSync(targetDir, { recursive: true });
    const original = [
      '---',
      'name: my-skill',
      'description: External skill.',
      'metadata:',
      '  short-description: External metadata',
      'allowed-tools: Read',
      '---',
      '# Content',
      ''
    ].join('\n');
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), original);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let warnedInvalid = false;
    try {
      await executeInit({ directory: targetDir, runGitInit: false });
      warnedInvalid = stderrSpy.mock.calls.some((args) => String(args[0]).includes('not a valid ESL skill source'));
    } finally {
      stderrSpy.mockRestore();
    }

    expect(warnedInvalid).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe(original);
    expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'))).toMatchObject({
      schemaVersion: 3,
      version: '0.1.0'
    });
  });

  it('uses the provided --license override when writing release.json', async () => {
    const targetDir = await executeInit({ directory: skillPath(), runGitInit: false, license: 'Apache-2.0' });

    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.license).toBe('Apache-2.0');
  });

  it('asks only for the fields that are still missing', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-home-'));
    fs.mkdirSync(skillPath(), { recursive: true });
    fs.writeFileSync(path.join(skillPath(), 'SKILL.md'), '---\nname: my-skill\ndescription: Kept.\n---\n');
    const asked: string[] = [];
    const promptText = async (question: string, fallback: string) => {
      asked.push(question);
      if (question.includes('icense')) return 'Apache-2.0';
      if (question.includes('eywords')) return 'review, docs';
      return fallback;
    };

    const targetDir = await executeInit({ directory: skillPath(), runGitInit: false, homeDir, promptText });

    expect(asked).toHaveLength(3);
    expect(asked.some((question) => question.includes('escription'))).toBe(false);
    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.license).toBe('Apache-2.0');
    expect(releaseJson.keywords).toEqual(['review', 'docs']);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('description: Kept.');
  });

  it('keeps interactive defaults when the answers are empty', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-home-'));
    const asked: string[] = [];
    const targetDir = await executeInit({
      directory: skillPath('fresh'),
      runGitInit: false,
      homeDir,
      promptText: async (question, fallback) => {
        asked.push(question);
        return fallback;
      }
    });

    expect(asked).toHaveLength(4);
    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.license).toBe('MIT');
    expect(releaseJson.keywords).toEqual([]);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('description: Use when');
  });

  it('does not prompt when input is disabled', async () => {
    const asked: string[] = [];
    await executeInit({
      directory: skillPath('fresh'),
      runGitInit: false,
      noInput: true,
      promptText: async (question: string, fallback: string) => {
        asked.push(question);
        return fallback;
      }
    });

    expect(asked).toHaveLength(0);
    expect(fs.existsSync(path.join(skillPath('fresh'), 'SKILL.md'))).toBe(true);
  });

  it('quotes a description that would otherwise break the frontmatter', async () => {
    const targetDir = await executeInit({
      directory: skillPath('fresh'),
      runGitInit: false,
      description: 'Review: dead links, "stale" docs'
    });

    const skillMd = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('description: "Review: dead links, \\"stale\\" docs"');
    expect(skillMd).toMatch(/^---\n[\s\S]*\n---\n/);
  });

  it('creates a nested directory path when it does not exist yet', async () => {
    const targetDir = await executeInit({ directory: path.join(tmpDir, 'a', 'b', 'my-skill'), runGitInit: false });

    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
  });

  it('skips git init when the target is already inside a git repository', async () => {
    execSync('git init -q', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email tester@example.com && git config user.name Tester', { cwd: tmpDir });

    await executeInit({ directory: skillPath() });

    expect(fs.existsSync(path.join(skillPath(), '.git'))).toBe(false);
  });
});
