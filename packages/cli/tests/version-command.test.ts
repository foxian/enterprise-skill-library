import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit, executeVersion } from '../src/index.js';

describe('esl version', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-command-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const initGit = (dir: string) => {
    execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email tester@example.com', { cwd: dir });
    execSync('git config user.name "Tester"', { cwd: dir });
    execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'ignore' });
  };

  const readReleaseJson = (dir: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, 'release.json'), 'utf8'));

  const git = (cmd: string, dir: string) =>
    execSync(cmd, { cwd: dir, encoding: 'utf8' });

  it('bumps patch on a source-form skill and writes the new version', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });
    initGit(skillDir);

    const result = await executeVersion('patch', { cwd: skillDir });

    expect(result).toBe('0.1.1');
    expect(readReleaseJson(skillDir).version).toBe('0.1.1');
  });

  it('bumps minor and major correctly', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });
    initGit(skillDir);

    expect(await executeVersion('minor', { cwd: skillDir })).toBe('0.2.0');
    expect(readReleaseJson(skillDir).version).toBe('0.2.0');
    expect(await executeVersion('major', { cwd: skillDir })).toBe('1.0.0');
    expect(readReleaseJson(skillDir).version).toBe('1.0.0');
  });

  it('sets an explicit version', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });
    initGit(skillDir);

    const result = await executeVersion('1.4.2', { cwd: skillDir });

    expect(result).toBe('1.4.2');
    expect(readReleaseJson(skillDir).version).toBe('1.4.2');
  });

  it('commits the manifest change and creates an annotated v<version> tag', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });
    initGit(skillDir);

    await executeVersion('patch', { cwd: skillDir });

    const log = git('git log --oneline', skillDir).trim().split('\n');
    expect(log).toHaveLength(2);
    expect(git('git tag -l', skillDir).trim()).toBe('v0.1.1');
    // annotated tag (not lightweight)
    const tagType = git('git cat-file -t v0.1.1', skillDir).trim();
    expect(tagType).toBe('tag');
  });

  it('creates the release tag when the version is already the target version', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });
    initGit(skillDir);

    // The first release: init seeded 0.1.0, so tagging it must not need a new commit.
    const result = await executeVersion('0.1.0', { cwd: skillDir });

    expect(result).toBe('0.1.0');
    expect(git('git tag -l', skillDir).trim()).toBe('v0.1.0');
    expect(git('git log --oneline', skillDir).trim().split('\n')).toHaveLength(1);
  });

  it('rejects when the working tree has uncommitted changes', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });
    initGit(skillDir);
    fs.writeFileSync(path.join(skillDir, 'scratch.txt'), 'dirty');

    await expect(executeVersion('patch', { cwd: skillDir })).rejects.toThrow(/not clean/);
  });

  it('rejects a directory without git and points the way', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });

    await expect(executeVersion('patch', { cwd: skillDir })).rejects.toThrow(/git/);
  });

  it('migrates a v1 manifest when given an explicit version', async () => {
    const skillDir = path.join(tmpDir, 'old-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: old-skill\ndescription: Legacy skill.\n---\n');
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
    initGit(skillDir);

    const result = await executeVersion('2.0.0', { cwd: skillDir });

    expect(result).toBe('2.0.0');
    const manifest = readReleaseJson(skillDir);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.version).toBe('2.0.0');
  });

  it('points a v1 manifest + bump keyword at explicit version', async () => {
    const skillDir = path.join(tmpDir, 'old-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: old-skill\ndescription: Legacy skill.\n---\n');
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
    initGit(skillDir);

    await expect(executeVersion('patch', { cwd: skillDir })).rejects.toThrow(/esl version <SemVer>/);
  });

  it('rejects a directory with no release.json', async () => {
    // `esl version` only operates on source-form skills (SKILL.md + release.json).
    // A directory with only a skill.json (installation copy) gets a clear error
    // pointing at the missing release manifest.
    const skillDir = path.join(tmpDir, 'install-copy');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/some-skill',
        version: '0.1.0',
        description: 'Installed copy',
        author: 'tester'
      })
    );
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: some-skill\ndescription: Installed.\n---\n');
    initGit(skillDir);

    await expect(executeVersion('patch', { cwd: skillDir })).rejects.toThrow(/release\.json/);
  });
});