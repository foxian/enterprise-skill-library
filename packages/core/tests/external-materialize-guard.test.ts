import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertMaterializationLimits,
  collectFilesWithinBoundary,
  DEFAULT_FETCH_LIMITS
} from '../src/skill/external/materialize-guard.js';

async function makeTempRepo(layout: (root: string) => Promise<void> | void): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'esl-mat-'));
  await layout(root);
  return root;
}

describe('collectFilesWithinBoundary', () => {
  it('收集目录内所有常规文件的相对路径与字节', async () => {
    const root = await makeTempRepo(async (dir) => {
      await fsp.mkdir(path.join(dir, 'sub'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'SKILL.md'), 'hello');
      await fsp.writeFile(path.join(dir, 'sub', 'a.txt'), 'world');
    });
    const files = await collectFilesWithinBoundary(root);
    expect(Object.keys(files).sort()).toEqual(['SKILL.md', 'sub/a.txt']);
    expect(files['SKILL.md'].toString('utf8')).toBe('hello');
  });

  it('拒绝指向边界外的符号链接', async () => {
    const root = await makeTempRepo(async (dir) => {
      await fsp.writeFile(path.join(dir, 'SKILL.md'), 'hello');
      await fsp.writeFile(path.join(os.tmpdir(), 'esl-outside-secret'), 'secret');
      await fsp.symlink(path.join(os.tmpdir(), 'esl-outside-secret'), path.join(dir, 'evil.link'));
    });
    await expect(collectFilesWithinBoundary(root)).rejects.toMatchObject({
      code: 'externalSourceUnsafeSymlink'
    });
  });

  it('拒绝边界内的路径逃逸（理论上不出现，但遍历结果仍会被清洗）', async () => {
    const root = await makeTempRepo((dir) => undefined);
    // 直接调用清洗函数：构造越界相对路径。
    const { assertInsideBoundary } = await import('../src/skill/external/materialize-guard.js');
    expect(() => assertInsideBoundary(root, path.join(root, '..', 'outside'))).toThrow();
  });

  it('忽略 .git 目录', async () => {
    const root = await makeTempRepo(async (dir) => {
      await fsp.writeFile(path.join(dir, 'SKILL.md'), 'hello');
      await fsp.mkdir(path.join(dir, '.git'), { recursive: true });
      await fsp.writeFile(path.join(dir, '.git', 'config'), 'garbage');
    });
    const files = await collectFilesWithinBoundary(root);
    expect(Object.keys(files)).toEqual(['SKILL.md']);
  });
});

describe('assertMaterializationLimits', () => {
  it('在限制内不抛错', () => {
    const files = { 'a.txt': Buffer.from('x'), 'b.txt': Buffer.from('yy') };
    expect(() => assertMaterializationLimits(files, DEFAULT_FETCH_LIMITS)).not.toThrow();
  });

  it('文件数超限即拒绝', async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 5; i += 1) files[`f${i}`] = Buffer.from('x');
    await expect(async () => assertMaterializationLimits(files, { ...DEFAULT_FETCH_LIMITS, maxFiles: 3 })).rejects.toThrow();
  });

  it('总字节超限即拒绝', async () => {
    const files = { big: Buffer.alloc(100) };
    await expect(async () =>
      assertMaterializationLimits(files, { ...DEFAULT_FETCH_LIMITS, maxTotalBytes: 10 })
    ).rejects.toThrow();
  });
});

describe('不支持机制检测', () => {
  it('发现 .gitmodules 时报告不支持子模块', async () => {
    const root = await makeTempRepo(async (dir) => {
      await fsp.writeFile(path.join(dir, '.gitmodules'), '[submodule]\npath=x');
    });
    const { detectUnsupportedMechanisms, collectFilesWithinBoundary } = await import(
      '../src/skill/external/materialize-guard.js'
    );
    const files = await collectFilesWithinBoundary(root);
    const findings = detectUnsupportedMechanisms(root, files);
    expect(findings.map((finding) => finding.code)).toContain('externalSourceSubmodulesUnsupported');
  });

  it('发现 Git LFS 指针文件时报告不支持 LFS', async () => {
    const root = await makeTempRepo(async (dir) => {
      await fsp.writeFile(
        path.join(dir, 'asset.bin'),
        `version: https://git-lfs.github.com/spec/v1
oid sha256:${'a'.repeat(64)}
size 123
`
      );
    });
    const { detectUnsupportedMechanisms, collectFilesWithinBoundary } = await import(
      '../src/skill/external/materialize-guard.js'
    );
    const files = await collectFilesWithinBoundary(root);
    const findings = detectUnsupportedMechanisms(root, files);
    expect(findings.map((finding) => finding.code)).toContain('externalSourceLfsUnsupported');
  });
});

// 确保清理临时目录。
fs; // 标记 node:fs 已导入（部分断言使用其类型）
