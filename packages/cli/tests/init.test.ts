import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit } from '../src/index.js';

describe('esl init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a source skeleton with SKILL.md and release.json but no skill.json', async () => {
    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false
    });

    expect(targetDir).toBe(path.join(tmpDir, 'my-skill'));
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'release.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'skill.json'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'scripts'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'references'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'assets'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'resources'))).toBe(false);

    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson).toEqual({
      schemaVersion: 2,
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

  it('uses the provided --license override', async () => {
    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false,
      license: 'Apache-2.0'
    });

    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.license).toBe('Apache-2.0');
  });

  it('asks for description, license, and keywords when prompted', async () => {
    const asked: string[] = [];
    const promptText = async (question: string, fallback: string) => {
      asked.push(question);
      if (question.includes('escription')) return 'Review code changes for dead links.';
      if (question.includes('icense')) return 'Apache-2.0';
      if (question.includes('eywords')) return 'review, docs';
      return fallback;
    };

    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false,
      promptText
    });

    expect(asked).toHaveLength(3);
    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.license).toBe('Apache-2.0');
    expect(releaseJson.keywords).toEqual(['review', 'docs']);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain(
      'description: Review code changes for dead links.'
    );
  });

  it('keeps the defaults when the answers are empty', async () => {
    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false,
      promptText: async (_question: string, fallback: string) => fallback
    });

    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.license).toBe('MIT');
    expect(releaseJson.keywords).toEqual([]);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('description: Use when');
  });

  it('does not ask about fields already given on the command line', async () => {
    const asked: string[] = [];
    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false,
      license: 'Apache-2.0',
      keywords: ['review'],
      description: 'Review code.',
      promptText: async (question: string, fallback: string) => {
        asked.push(question);
        return fallback;
      }
    });

    expect(asked).toHaveLength(0);
    const releaseJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'));
    expect(releaseJson.license).toBe('Apache-2.0');
    expect(releaseJson.keywords).toEqual(['review']);
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('description: Review code.');
  });

  it('quotes a description that would otherwise break the frontmatter', async () => {
    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false,
      description: 'Review: dead links, "stale" docs'
    });

    const skillMd = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('description: "Review: dead links, \\"stale\\" docs"');
    // The generated source must still validate.
    expect(skillMd).toMatch(/^---\n[\s\S]*\n---\n/);
  });

  it('does not prompt when input is disabled', async () => {
    const asked: string[] = [];
    await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false,
      noInput: true,
      promptText: async (question: string, fallback: string) => {
        asked.push(question);
        return fallback;
      }
    });

    expect(asked).toHaveLength(0);
  });

  it('rejects invalid skill names', async () => {
    await expect(executeInit('my-skill', { cwd: tmpDir, runGitInit: false })).rejects.toThrow(
      '@namespace/skill-name'
    );
  });

  it('does not overwrite existing directories', async () => {
    fs.mkdirSync(path.join(tmpDir, 'my-skill'));

    await expect(executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false })).rejects.toThrow(
      'already exists'
    );
  });
});