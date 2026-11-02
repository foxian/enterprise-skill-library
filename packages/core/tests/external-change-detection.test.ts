import { describe, expect, it } from 'vitest';
import {
  computeContentFingerprint,
  detectContentChange,
  nextExternalVersion
} from '../src/skill/external/change-detection.js';
import type { ByteFileMap } from '../src/skill/published-package-archive.js';

function mapOf(entries: Record<string, string>): ByteFileMap {
  return Object.fromEntries(
    Object.entries(entries).map(([filePath, content]) => [filePath, Buffer.from(content, 'utf8')])
  );
}

describe('computeContentFingerprint', () => {
  it('对同一内容给出稳定指纹', () => {
    const a = computeContentFingerprint(mapOf({ 'SKILL.md': 'hello', 'a.txt': 'x' }));
    const b = computeContentFingerprint(mapOf({ 'SKILL.md': 'hello', 'a.txt': 'x' }));
    expect(a).toBe(b);
  });

  it('与文件顺序无关', () => {
    const a = computeContentFingerprint(mapOf({ 'a.txt': 'x', 'b.txt': 'y' }));
    const b = computeContentFingerprint(mapOf({ 'b.txt': 'y', 'a.txt': 'x' }));
    expect(a).toBe(b);
  });

  it('内容不同则指纹不同', () => {
    const a = computeContentFingerprint(mapOf({ 'a.txt': 'x' }));
    const b = computeContentFingerprint(mapOf({ 'a.txt': 'y' }));
    expect(a).not.toBe(b);
  });
});

describe('detectContentChange', () => {
  it('文件内容修改算变化', () => {
    const before = mapOf({ 'SKILL.md': 'v1' });
    const after = mapOf({ 'SKILL.md': 'v2' });
    expect(detectContentChange(before, after).changed).toBe(true);
  });

  it('新增文件算变化', () => {
    const before = mapOf({ 'SKILL.md': 'v1' });
    const after = mapOf({ 'SKILL.md': 'v1', 'new.txt': 'x' });
    expect(detectContentChange(before, after).changed).toBe(true);
  });

  it('删除文件算变化', () => {
    const before = mapOf({ 'SKILL.md': 'v1', 'old.txt': 'x' });
    const after = mapOf({ 'SKILL.md': 'v1' });
    expect(detectContentChange(before, after).changed).toBe(true);
  });

  it('内容一致不算变化', () => {
    const before = mapOf({ 'SKILL.md': 'v1', 'a.txt': 'x' });
    const after = mapOf({ 'SKILL.md': 'v1', 'a.txt': 'x' });
    expect(detectContentChange(before, after).changed).toBe(false);
  });

  it('报告新增/修改/删除的路径', () => {
    const before = mapOf({ 'keep.txt': '1', 'mod.txt': 'old', 'gone.txt': 'x' });
    const after = mapOf({ 'keep.txt': '1', 'mod.txt': 'new', 'added.txt': 'y' });
    const result = detectContentChange(before, after);
    expect(result.added).toEqual(['added.txt']);
    expect(result.modified).toEqual(['mod.txt']);
    expect(result.removed).toEqual(['gone.txt']);
  });

  it('基于字节比较，二进制改动可被识别', () => {
    const before = { 'a.bin': Buffer.from([0, 1, 2]) };
    const after = { 'a.bin': Buffer.from([0, 1, 3]) };
    expect(detectContentChange(before, after).changed).toBe(true);
  });
});

describe('nextExternalVersion', () => {
  it('没有历史版本时首次发布为 0.1.0', () => {
    expect(nextExternalVersion([])).toBe('0.1.0');
    expect(nextExternalVersion(undefined)).toBe('0.1.0');
  });

  it('基于最近成功版本递增 patch', () => {
    expect(nextExternalVersion(['0.1.0'])).toBe('0.1.1');
    expect(nextExternalVersion(['0.1.0', '0.1.1', '0.1.2'])).toBe('0.1.3');
  });

  it('只递增 patch，不改动 minor/major', () => {
    expect(nextExternalVersion(['1.5.9'])).toBe('1.5.10');
  });

  it('以最高版本为基准，忽略传入顺序', () => {
    expect(nextExternalVersion(['0.1.0', '0.1.5', '0.1.2'])).toBe('0.1.6');
  });

  it('忽略预发布版本，按稳定版递增', () => {
    expect(nextExternalVersion(['0.1.0', '0.2.0-beta.1'])).toBe('0.1.1');
  });
});
