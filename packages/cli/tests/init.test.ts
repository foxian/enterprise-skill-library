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

  it('creates a minimal runtime skill package', async () => {
    const targetDir = await executeInit('@myorg/my-skill', {
      cwd: tmpDir,
      runGitInit: false
    });

    expect(targetDir).toBe(path.join(tmpDir, 'my-skill'));
    expect(fs.existsSync(path.join(targetDir, 'skill.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'scripts'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'references'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'assets'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'resources'))).toBe(false);

    const skillJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'skill.json'), 'utf8'));
    expect(skillJson.name).toBe('@myorg/my-skill');
    expect(skillJson.version).toBe('0.1.0');

    const skillMd = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: my-skill');
    expect(skillMd).toContain('description: Use when');
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
