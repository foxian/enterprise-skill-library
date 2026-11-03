import semver from 'semver';
import { sha256Integrity, type ByteFileMap } from '../published-package-archive.js';

// 外部引用只在“选定技能目录 + 已确认的目录外许可/署名文件”范围内比较内容
// （ADR-0074）。指纹基于归一化路径排序后的字节，不依赖抓取顺序。
export function computeContentFingerprint(files: ByteFileMap): string {
  const paths = Object.keys(files).sort();
  const input = paths
    .map((filePath) => `${filePath}\0${files[filePath].toString('base64')}`)
    .join('\n');
  return sha256Integrity(Buffer.from(input, 'utf8'));
}

export interface ContentChange {
  changed: boolean;
  added: string[];
  modified: string[];
  removed: string[];
  previousFingerprint?: string;
  nextFingerprint: string;
}

export function detectContentChange(before: ByteFileMap, after: ByteFileMap): ContentChange {
  const previousFingerprint = computeContentFingerprint(before);
  const nextFingerprint = computeContentFingerprint(after);
  const beforePaths = new Set(Object.keys(before));
  const afterPaths = new Set(Object.keys(after));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const filePath of afterPaths) {
    if (!beforePaths.has(filePath)) {
      added.push(filePath);
    } else if (!before[filePath].equals(after[filePath])) {
      modified.push(filePath);
    }
  }
  for (const filePath of beforePaths) {
    if (!afterPaths.has(filePath)) removed.push(filePath);
  }

  return {
    changed: previousFingerprint !== nextFingerprint,
    added: added.sort(),
    modified: modified.sort(),
    removed: removed.sort(),
    previousFingerprint,
    nextFingerprint
  };
}

// ESL 独立编号（ADR-0074）：首次 0.1.0，之后只递增 patch。预发布版本不纳入
// 基准——外部自动发布只产生稳定版。
export function nextExternalVersion(publishedVersions: readonly string[] | undefined): string {
  if (!publishedVersions || publishedVersions.length === 0) return '0.1.0';
  const stable = publishedVersions.filter((version) => semver.valid(version) && semver.prerelease(version) === null);
  if (stable.length === 0) return '0.1.0';
  const highest = semver.maxSatisfying(stable, '*', { includePrerelease: false })!;
  return semver.inc(highest, 'patch')!;
}
