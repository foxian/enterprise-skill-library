import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o222).toBe(0);
  });

  it('rejects when it cannot make a copied file read-only', async () => {
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Hello');
    const chmod = vi.spyOn(fs.promises, 'chmod').mockRejectedValueOnce(new Error('permission denied'));

    try {
      await expect(copySkillDirectory(srcDir, destDir)).rejects.toThrow('permission denied');
    } finally {
      chmod.mockRestore();
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

  it('rejects an identical source and target before removing files', async () => {
    const sourceFile = path.join(srcDir, 'SKILL.md');
    fs.writeFileSync(sourceFile, '# Hello');

    await expect(copySkillDirectory(srcDir, srcDir)).rejects.toThrow(/must not overlap/i);

    expect(fs.readFileSync(sourceFile, 'utf8')).toBe('# Hello');
  });

  it('rejects a target nested inside the source', async () => {
    const sourceFile = path.join(srcDir, 'SKILL.md');
    const nestedTarget = path.join(srcDir, 'copy');
    fs.writeFileSync(sourceFile, '# Hello');

    await expect(copySkillDirectory(srcDir, nestedTarget)).rejects.toThrow(/must not overlap/i);

    expect(fs.readFileSync(sourceFile, 'utf8')).toBe('# Hello');
    expect(fs.existsSync(nestedTarget)).toBe(false);
  });

  it('rejects a target that contains the source', async () => {
    const sourceFile = path.join(srcDir, 'SKILL.md');
    fs.writeFileSync(sourceFile, '# Hello');

    await expect(copySkillDirectory(srcDir, tmpDir)).rejects.toThrow(/must not overlap/i);

    expect(fs.readFileSync(sourceFile, 'utf8')).toBe('# Hello');
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

  it('does not make files behind a directory symlink writable', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-rm-link-'));
    const target = path.join(tmpDir, 'target');
    const externalDirectory = path.join(tmpDir, 'external');
    const externalFile = path.join(externalDirectory, 'file.txt');
    const link = path.join(target, 'external-link');
    fs.mkdirSync(target);
    fs.mkdirSync(externalDirectory);
    fs.writeFileSync(externalFile, 'content');
    fs.chmodSync(externalFile, 0o444);
    fs.symlinkSync(externalDirectory, link, 'junction');

    const originalReaddir = fs.promises.readdir;
    const readdir = vi.spyOn(fs.promises, 'readdir').mockImplementation(async (directory, options) => {
      if (directory === target && options && typeof options === 'object' && 'withFileTypes' in options) {
        return [{ name: 'external-link', isDirectory: () => true }] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>;
      }
      return originalReaddir(directory, options as { withFileTypes: true });
    });

    try {
      await removeDirectory(target);
      const stat = fs.statSync(externalFile);
      // eslint-disable-next-line no-bitwise
      expect(stat.mode & 0o222).toBe(0);
    } finally {
      readdir.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
