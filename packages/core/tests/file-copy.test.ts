import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copySkillDirectory, removeDirectory } from '../src/store/file-copy.js';

describe('copySkillDirectory', () => {
  let tmpDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-copy-'));
    srcDir = path.join(tmpDir, 'source');
    destDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(srcDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies files and subdirectories', async () => {
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Hello');
    fs.mkdirSync(path.join(srcDir, 'scripts'));
    fs.writeFileSync(path.join(srcDir, 'scripts', 'run.sh'), '#!/bin/bash');

    await copySkillDirectory(srcDir, destDir);

    expect(fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf8')).toBe('# Hello');
    expect(fs.readFileSync(path.join(destDir, 'scripts', 'run.sh'), 'utf8')).toBe('#!/bin/bash');
  });

  it('excludes .git directory', async () => {
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Hello');
    fs.mkdirSync(path.join(srcDir, '.git'));
    fs.writeFileSync(path.join(srcDir, '.git', 'HEAD'), 'ref: refs/heads/main');

    await copySkillDirectory(srcDir, destDir);

    expect(fs.existsSync(path.join(destDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, '.git'))).toBe(false);
  });

  it('sets copied files to read-only', async () => {
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Hello');

    await copySkillDirectory(srcDir, destDir);

    const stat = fs.statSync(path.join(destDir, 'SKILL.md'));
    if (process.platform === 'win32') {
      expect(fs.existsSync(path.join(destDir, 'SKILL.md'))).toBe(true);
    } else {
      // eslint-disable-next-line no-bitwise
      expect(stat.mode & 0o222).toBe(0);
    }
  });

  it('overwrites existing destination', async () => {
    fs.mkdirSync(destDir);
    fs.writeFileSync(path.join(destDir, 'old-file.txt'), 'old');

    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# New');

    await copySkillDirectory(srcDir, destDir);

    expect(fs.existsSync(path.join(destDir, 'old-file.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf8')).toBe('# New');
  });
});

describe('removeDirectory', () => {
  it('removes a directory recursively', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-rm-'));
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');

    await removeDirectory(tmpDir);

    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  it('does not throw if directory does not exist', async () => {
    await expect(removeDirectory('/nonexistent/path/xyz')).resolves.toBeUndefined();
  });
});
