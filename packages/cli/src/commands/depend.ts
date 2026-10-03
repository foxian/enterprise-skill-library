import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  fileExists,
  highestSatisfyingVersion,
  highestStableVersion,
  RELEASE_DEPENDENCY_TARGET_PATTERN,
  validateReleaseDependencyTarget,
  validateReleaseManifest
} from '@esl/core';
import { ApiError } from '../api-error.js';
import { executeInfo } from './info.js';
import type { NetworkCommandOptions } from './network-options.js';

export interface DependOptions extends NetworkCommandOptions {
  /** 技能源目录；缺省取当前目录（与 version/publish 一致，也支持全局 -C）。 */
  directory?: string;
}

export interface DependEdge {
  identity: string;
  range: string;
}

/**
 * 解析 `@namespace/name` 或 `@namespace/name@range`。第二段 @ 之后为作者给出
 * 的范围；remove 不接受范围。
 */
function parseDependTarget(input: string, allowRange: boolean): { identity: string; range?: string } | null {
  // 复用 core 的目标形态正则：身份与可选范围以第二个 @ 分隔。
  const separator = input.indexOf('@', 1);
  const identity = separator === -1 ? input : input.slice(0, separator);
  const range = separator === -1 ? undefined : input.slice(separator + 1);
  if (!RELEASE_DEPENDENCY_TARGET_PATTERN.test(identity)) return null;
  if (range !== undefined && !allowRange) return null;
  return { identity, range };
}

async function readSourceManifest(directory: string) {
  const manifestPath = path.join(directory, 'release.json');
  if (!(await fileExists(manifestPath))) {
    throw new Error(`Cannot find release.json in ${directory}; run \`esl init\` in the skill source first`);
  }
  const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
  const validation = validateReleaseManifest(parsed);
  if (!validation.success) {
    throw new Error(`Invalid release.json in ${directory}: ${validation.errors.join(', ')}`);
  }
  return { manifestPath, manifest: validation.data };
}

/** 列出技能源清单中的发布依赖（无参数 `esl depend` 等同 list）。 */
export async function executeDependList(options: DependOptions = {}): Promise<{ dependencies: Record<string, string> }> {
  const directory = options.directory ?? process.cwd();
  const { manifest } = await readSourceManifest(directory);
  return { dependencies: manifest.dependencies };
}

/**
 * 声明（或更新）一条发布依赖：add 时必须向 Registry 解析目标——非法目标、
 * 不可见、无稳定版/无满足范围都会失败且不写清单，避免悬空边。只改技能源
 * release.json，不碰项目清单、Skill Store、Tool Link，也不自动升版或提交。
 */
export async function executeDependAdd(
  target: string,
  options: DependOptions = {}
): Promise<DependEdge & { updated: boolean }> {
  const parsed = parseDependTarget(target, true);
  if (!parsed || validateReleaseDependencyTarget(parsed.identity)) {
    throw new ApiError(400, `Invalid release dependency target: ${target}`, {
      code: 'releaseDependencyTargetInvalid',
      params: { identity: target }
    });
  }
  // 范围本身非法时不必联网，也不写清单。
  if (parsed.range !== undefined && semver.validRange(parsed.range) === null) {
    throw new ApiError(400, `Invalid SemVer range: ${parsed.range}`, {
      code: 'releaseVersionMustBeValidSemver'
    });
  }

  let info;
  try {
    info = await executeInfo(parsed.identity, options);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        throw new ApiError(403, error.rawMessage, {
          code: 'releaseDependencyNotVisible',
          params: { identity: parsed.identity }
        });
      }
      if (error.status === 404) {
        throw new ApiError(404, error.rawMessage, {
          code: 'releaseDependencyNoRelease',
          params: { identity: parsed.identity }
        });
      }
    }
    throw error;
  }

  let range: string;
  if (parsed.range !== undefined) {
    if (!highestSatisfyingVersion(info.versions ?? [], parsed.range)) {
      throw new ApiError(409, 'no published version satisfies the range', {
        code: 'releaseDependencyNoSatisfyingVersion',
        params: { identity: parsed.identity }
      });
    }
    range = parsed.range;
  } else {
    // 默认与 install 选最高稳定版一致：预发布不进入默认声明。
    const stable = highestStableVersion(info.versions ?? []);
    if (!stable) {
      throw new ApiError(409, 'no stable release available', {
        code: 'releaseDependencyNoSatisfyingVersion',
        params: { identity: parsed.identity }
      });
    }
    range = `^${stable}`;
  }

  const directory = options.directory ?? process.cwd();
  const { manifestPath, manifest } = await readSourceManifest(directory);
  const identity = info.currentName ?? parsed.identity;
  const updated = Object.hasOwn(manifest.dependencies, identity);
  manifest.dependencies = { ...manifest.dependencies, [identity]: range };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { identity, range, updated };
}

/** 删除一条发布依赖；边不存在时明确失败。 */
export async function executeDependRemove(
  target: string,
  options: DependOptions = {}
): Promise<{ identity: string }> {
  const parsed = parseDependTarget(target, false);
  if (!parsed || validateReleaseDependencyTarget(parsed.identity)) {
    throw new ApiError(400, `Invalid release dependency target: ${target}`, {
      code: 'releaseDependencyTargetInvalid',
      params: { identity: target }
    });
  }

  const directory = options.directory ?? process.cwd();
  const { manifestPath, manifest } = await readSourceManifest(directory);
  if (!Object.hasOwn(manifest.dependencies, parsed.identity)) {
    throw new ApiError(404, 'dependency edge not found', {
      code: 'dependEdgeNotFound',
      params: { identity: parsed.identity }
    });
  }
  delete manifest.dependencies[parsed.identity];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { identity: parsed.identity };
}

/** 人类可读的依赖列表：身份与范围。 */
export function formatDependList(result: { dependencies: Record<string, string> }): string {
  const entries = Object.entries(result.dependencies);
  if (entries.length === 0) return 'No release dependencies declared.';
  return entries.map(([identity, range]) => `${identity} ${range}`).join('\n');
}
