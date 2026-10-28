import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { executeExportSource } from '@esl/core';

describe('esl source export', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function source(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-export-'));
    roots.push(root);
    const directory = path.join(root, 'reviewer');
    fs.mkdirSync(directory);
    execFileSync('git', ['init', '-q', directory]);
    fs.writeFileSync(path.join(directory, 'SKILL.md'), '---\nname: reviewer\ndescription: Review code\n---\n');
    fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify({ schemaVersion: 4, name: '@first/reviewer', version: '1.0.0', license: 'MIT', displayName: '代码审查', keywords: [], compatibility: {}, dependencies: {} }));
    fs.writeFileSync(path.join(directory, '.gitignore'), 'ignored.txt\n');
    execFileSync('git', ['add', '.'], { cwd: directory });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial'], { cwd: directory });
    return directory;
  }

  it('导出无 Git 身份的已提交副本，保留通用元数据与原目录', async () => {
    const directory = source();
    const result = await executeExportSource({ directory });
    expect(result.output).toBe(path.join(path.dirname(directory), 'reviewer-export'));
    expect(fs.existsSync(path.join(result.output, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(result.output, '.gitignore'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(result.output, 'release.json'), 'utf8'))).toMatchObject({ name: 'reviewer', displayName: '代码审查', license: 'MIT' });
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'release.json'), 'utf8')).name).toBe('@first/reviewer');
    expect(fs.existsSync(path.join(directory, '.git'))).toBe(true);
  });

  it('接受通过符号链接进入的 Git 仓库根', async () => {
    const directory = source();
    const linked = path.join(path.dirname(directory), 'reviewer-link');
    fs.symlinkSync(directory, linked, 'junction');

    const result = await executeExportSource({ directory: linked });

    expect(result.output).toBe(path.join(path.dirname(linked), 'reviewer-export'));
    expect(fs.existsSync(path.join(result.output, 'SKILL.md'))).toBe(true);
  });

  it('拒绝有未提交修改或未跟踪文件，不产生副本', async () => {
    const directory = source();
    fs.writeFileSync(path.join(directory, 'ignored.txt'), 'ignored');
    fs.writeFileSync(path.join(directory, 'extra.txt'), 'untracked');
    await expect(executeExportSource({ directory })).rejects.toThrow(/uncommitted changes/);
    expect(fs.existsSync(path.join(path.dirname(directory), 'reviewer-export'))).toBe(false);
    fs.rmSync(path.join(directory, 'extra.txt'));
    const result = await executeExportSource({ directory });
    expect(fs.existsSync(path.join(result.output, 'ignored.txt'))).toBe(false);
    await expect(executeExportSource({ directory })).rejects.toThrow(/already exists/);
  });

  it('拒绝输出到源目录内部和未提交的清单', async () => {
    const directory = source();
    await expect(executeExportSource({ directory, output: path.join(directory, 'seed') })).rejects.toThrow(/must not be inside/);
    execFileSync('git', ['rm', '--cached', 'release.json'], { cwd: directory });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'remove manifest'], { cwd: directory });
    await expect(executeExportSource({ directory })).rejects.toThrow(/uncommitted changes|must be committed/);
  });
});
