import fs from 'node:fs/promises';
import path from 'node:path';
import type { ByteFileMap } from '../published-package-archive.js';

// 抓取后物化阶段的安全边界（ADR-0074）：限制文件数/体积，拒绝越界路径与符号链接，
// 不处理子模块与 Git LFS。物化只读数据，绝不执行其中的脚本或安装依赖。

export interface FetchLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxSingleFileBytes: number;
}

// 默认上限偏保守，防止单个上游耗尽服务器资源。
export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  maxFiles: 2000,
  maxTotalBytes: 50 * 1024 * 1024,
  maxSingleFileBytes: 10 * 1024 * 1024
};

export class MaterializeError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'MaterializeError';
  }
}

// 断言目标路径仍在边界目录之内（规范化后做前缀比较）。
export function assertInsideBoundary(boundary: string, target: string): void {
  const resolvedBoundary = path.resolve(boundary);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBoundary, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new MaterializeError(
      `Path escapes the selected source boundary: ${target}`,
      'externalSourcePathTraversal'
    );
  }
}

async function walk(
  directory: string,
  boundary: string,
  files: ByteFileMap,
  base: string
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    // 不把 Git 元数据当技能内容。
    if (entry.name === '.git') continue;
    if (entry.isSymbolicLink()) {
      // 符号链接必须仍指向边界内，且解析后不是边界外文件。
      const real = await fs.realpath(absolute).catch(() => {
        throw new MaterializeError(`Unresolvable symbolic link: ${entry.name}`, 'externalSourceUnsafeSymlink');
      });
      try {
        assertInsideBoundary(boundary, real);
      } catch (error) {
        if (error instanceof MaterializeError) {
          throw new MaterializeError(
            `Symbolic link points outside the source boundary: ${entry.name}`,
            'externalSourceUnsafeSymlink'
          );
        }
        throw error;
      }
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) {
        await walk(absolute, boundary, files, base);
      } else if (stat.isFile()) {
        files[path.relative(base, absolute).split(path.sep).join('/')] = await fs.readFile(absolute);
      }
      continue;
    }
    if (entry.isDirectory()) {
      await walk(absolute, boundary, files, base);
    } else if (entry.isFile()) {
      files[path.relative(base, absolute).split(path.sep).join('/')] = await fs.readFile(absolute);
    }
    // 其他类型（FIFO/socket 等）忽略，不纳入包。
  }
}

// 收集边界目录内的全部文件，任何越界符号链接都会失败。
export async function collectFilesWithinBoundary(boundary: string): Promise<ByteFileMap> {
  const resolvedBoundary = await fs.realpath(boundary);
  const files: ByteFileMap = {};
  await walk(resolvedBoundary, resolvedBoundary, files, resolvedBoundary);
  return files;
}

export function assertMaterializationLimits(files: ByteFileMap, limits: FetchLimits): void {
  const paths = Object.keys(files);
  if (paths.length > limits.maxFiles) {
    throw new MaterializeError(
      `Repository contains ${paths.length} files, exceeding the limit of ${limits.maxFiles}`,
      'externalSourceTooManyFiles'
    );
  }
  let total = 0;
  for (const filePath of paths) {
    const size = files[filePath].length;
    if (size > limits.maxSingleFileBytes) {
      throw new MaterializeError(
        `File ${filePath} exceeds the single-file size limit`,
        'externalSourceFileTooLarge'
      );
    }
    total += size;
  }
  if (total > limits.maxTotalBytes) {
    throw new MaterializeError(
      `Repository content (${total} bytes) exceeds the total size limit`,
      'externalSourceTooLarge'
    );
  }
}

export interface UnsupportedMechanism {
  code: string;
  message: string;
  path?: string;
}

const LFS_POINTER_PATTERN = /^version: https:\/\/git-lfs\.github\.com\/spec\/v1\s*\noid sha256:[0-9a-f]{64}\s*\nsize \d+\s*$/;

// 检测第一版不支持的机制：子模块（.gitmodules）与 Git LFS 指针文件。
export function detectUnsupportedMechanisms(boundary: string, files?: ByteFileMap): UnsupportedMechanism[] {
  const findings: UnsupportedMechanism[] = [];
  // .gitmodules 检测在调用方传入工作目录路径时完成；这里用同步读会破坏纯函数，
  // 因此 .gitmodules 由抓取器额外检查，此函数仅在 files 已含该文件时报告。
  if (files && files['.gitmodules']) {
    const content = files['.gitmodules'].toString('utf8').trim();
    if (content.length > 0) {
      findings.push({
        code: 'externalSourceSubmodulesUnsupported',
        message: 'Submodules are not supported in external references',
        path: '.gitmodules'
      });
    }
  }
  if (files) {
    for (const [filePath, bytes] of Object.entries(files)) {
      if (filePath === '.gitmodules') continue;
      if (LFS_POINTER_PATTERN.test(bytes.toString('utf8').trim())) {
        findings.push({
          code: 'externalSourceLfsUnsupported',
          message: 'Git LFS objects are not supported in external references',
          path: filePath
        });
      }
    }
  }
  return findings;
}
