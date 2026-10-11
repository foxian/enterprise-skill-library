import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCleanSource } from '@esl/core';
import { createProgram } from '../src/bin/esl.js';

describe('esl source clean', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function source(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-clean-'));
    roots.push(root);
    const directory = path.join(root, 'reviewer');
    fs.mkdirSync(directory);
    execFileSync('git', ['init', '-q', directory]);
    fs.writeFileSync(path.join(directory, 'SKILL.md'), '---\nname: reviewer\ndescription: Review code\n---\n');
    fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify({ schemaVersion: 4, name: '@first/reviewer', version: '1.0.0', license: 'MIT' }));
    fs.writeFileSync(path.join(directory, 'release.json.before-reset'), 'backup');
    fs.mkdirSync(path.join(directory, 'scripts'));
    fs.writeFileSync(path.join(directory, 'scripts', 'check.sh'), 'echo ok\n');
    return directory;
  }

  it('删除 Git 与 ESL 清单痕迹，保留技能文档和代码', async () => {
    const directory = source();
    const result = await executeCleanSource({ directory });
    expect(result.removed).toEqual(expect.arrayContaining(['.git', 'release.json', 'release.json.before-reset']));
    expect(fs.existsSync(path.join(directory, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(directory, 'release.json'))).toBe(false);
    expect(fs.existsSync(path.join(directory, 'release.json.before-reset'))).toBe(false);
    expect(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8')).toContain('Review code');
    expect(fs.existsSync(path.join(directory, 'scripts', 'check.sh'))).toBe(true);
  });

  it('没有 SKILL.md 时拒绝清理', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-clean-'));
    roots.push(root);
    await expect(executeCleanSource({ directory: root })).rejects.toThrow(/no SKILL.md/);
  });

  it('已经干净时拒绝空操作', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-clean-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nname: reviewer\ndescription: Review code\n---\n');
    await expect(executeCleanSource({ directory: root })).rejects.toThrow(/no Git repository or ESL release manifest/);
  });

  it('非交互无 --force 时拒绝，带 --force 才清理', async () => {
    const directory = source();
    const program = createProgram();
    await expect(program.parseAsync(['--no-input', 'source', 'clean', directory], { from: 'user' })).rejects.toThrow(/--force/);
    expect(fs.existsSync(path.join(directory, '.git'))).toBe(true);
    await program.parseAsync(['--no-input', 'source', 'clean', directory, '--force'], { from: 'user' });
    expect(fs.existsSync(path.join(directory, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(directory, 'release.json'))).toBe(false);
  });
});
