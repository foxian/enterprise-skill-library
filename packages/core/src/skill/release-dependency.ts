import semver from 'semver';
import { RESERVED_SCOPE_NAMES } from '../org/account-policy.js';

// 发布依赖目标的唯一合法形态：已发布的 Server-hosted 技能身份（ADR-0056）。
export const RELEASE_DEPENDENCY_TARGET_PATTERN = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/;

/** 目标合法时返回 null；非法（保留 Scope、file:、路径、残缺身份）时返回对应错误码。 */
export function validateReleaseDependencyTarget(identity: string): 'releaseDependencyTargetInvalid' | null {
  const match = identity.match(RELEASE_DEPENDENCY_TARGET_PATTERN);
  if (!match || RESERVED_SCOPE_NAMES.has(match[1])) {
    return 'releaseDependencyTargetInvalid';
  }
  return null;
}

/**
 * 消费端多根合并（ADR-0056）：同一身份已装版本与入图版本不一致时取其中
 * 更高者，前提是它满足各方 Release Manifest 声明的全部范围；不满足即冲突，
 * 调用方放弃整次安装、已有图保持原状。
 */
export function chooseMergedVersion(input: {
  existingVersion: string;
  incomingVersion: string;
  ranges: readonly string[];
}): { version: string } | { conflict: true } {
  const candidate = semver.gt(input.incomingVersion, input.existingVersion)
    ? input.incomingVersion
    : input.existingVersion;
  if (input.ranges.every((range) => semver.satisfies(candidate, range))) {
    return { version: candidate };
  }
  return { conflict: true };
}

/**
 * 多条 SemVer 范围是否有公共可满足区间。node-semver 不提供交集运算，这里用
 * 「见证版本」判定：各范围的比较器版本（及其 patch/minor/major、prerelease
 * 递进）覆盖了所有区间边界——若存在交集，某个见证版本会同时满足全部范围。
 */
export function rangesIntersect(ranges: readonly string[]): boolean {
  const validRanges = ranges.filter((range) => semver.validRange(range) !== null);
  if (validRanges.length !== ranges.length || validRanges.length === 0) {
    return false;
  }
  const witnesses = new Set<string>(['0.0.0']);
  for (const range of validRanges) {
    for (const comparators of new semver.Range(range).set) {
      for (const comparator of comparators) {
        const boundary = comparator.semver;
        if (!boundary?.version) continue;
        witnesses.add(boundary.version);
        for (const increment of ['patch', 'minor', 'major'] as const) {
          const bumped = semver.inc(boundary.version, increment);
          if (bumped) witnesses.add(bumped);
        }
        if (boundary.prerelease.length > 0) {
          const preBumped = semver.inc(boundary.version, 'prerelease');
          if (preBumped) witnesses.add(preBumped);
        }
      }
    }
  }
  return [...witnesses].some((witness) =>
    validRanges.every((range) => semver.satisfies(witness, range))
  );
}

/** 在给定版本里取同时满足全部范围的最高版本（预发布按 node-semver 默认规则排除）。 */
export function highestSatisfyingAllRanges(
  versions: readonly string[],
  ranges: readonly string[]
): string | undefined {
  return versions
    .filter((version) => semver.valid(version) !== null)
    .filter((version) => ranges.every((range) => semver.satisfies(version, range)))
    .sort(semver.rcompare)[0];
}

export interface ReleaseLockEntry {
  skillId: string;
  version: string;
  checksum: string;
}

export interface ReleaseGraphNode {
  identity: string;
  skillId: string;
  version: string;
  checksum: string;
  visibility: 'public' | 'private';
  dependencies: Record<string, string>;
}

/** 图解析的数据源：listVersions 只返回读者读得到的版本，无权时抛 ReleaseGraphError。 */
export interface ReleaseGraphSource {
  listVersions(identity: string): Promise<string[]>;
  load(identity: string, version: string): Promise<ReleaseGraphNode>;
}

export interface ReleaseGraphOptions {
  /** 根技能可见性：public 时要求全链 public。 */
  rootVisibility?: 'public' | 'private';
  /** 根技能身份：提供后根依赖自己（或链回根）立即按环处理。 */
  rootIdentity?: string;
}

export const RELEASE_GRAPH_ERROR_CODES = [
  'releaseDependencyTargetInvalid',
  'releaseDependencyNoRelease',
  'releaseDependencyNoSatisfyingVersion',
  'releaseDependencyRangesDoNotIntersect',
  'releaseDependencyCycle',
  'releaseDependencyNotVisible',
  'releaseDependencyPublicChainMustBePublic'
] as const;

export type ReleaseGraphErrorCode = (typeof RELEASE_GRAPH_ERROR_CODES)[number];

/**
 * 图解析失败码 → HTTP 状态：清单写法问题 400；无权读取 403；其余为与 Registry
 * 状态冲突（无交集、环、无满足版本、Public 链不合法）409。server 与 CLI 共用。
 */
export function releaseGraphErrorStatus(code: ReleaseGraphErrorCode): number {
  if (code === 'releaseDependencyTargetInvalid') return 400;
  if (code === 'releaseDependencyNotVisible') return 403;
  return 409;
}

/** 图解析失败：code 为稳定 API Error Code，errorParams 供文案插值。 */
export class ReleaseGraphError extends Error {
  constructor(
    readonly code: ReleaseGraphErrorCode,
    readonly errorParams: Record<string, string> = {}
  ) {
    super(code);
    this.name = 'ReleaseGraphError';
  }
}

/** 触发整轮重解析：某已选身份遇到不满足的新范围，需把该范围作为持久约束重来。 */
class ResolveRestart extends Error {
  constructor(
    readonly identity: string,
    readonly range: string
  ) {
    super('resolve-restart');
    this.name = 'ResolveRestart';
  }
}

/**
 * 展开发布依赖图（ADR-0056）：同一 Skill Identity 累积全部 SemVer 范围，在交集上
 * 取最高满足版本，并按该版本自己的发布依赖继续展开。已选身份遇到不满足的新范围时
 * 把该范围固化为持久约束、整轮重解析——这样重选后的旧子图范围不会残留，避免把
 * 已不可达的边算进交集而误报冲突。重边汇合（钻石）不是环，回边（含自依赖）才是环。
 */
export async function resolveReleaseGraph(
  roots: Record<string, string>,
  source: ReleaseGraphSource,
  options: ReleaseGraphOptions = {}
): Promise<Record<string, ReleaseLockEntry>> {
  // 持久约束：跨轮累积「迫使重选」的范围，确保下一轮一开始就沿交集解析。
  const constraints = new Map<string, string[]>();
  const addConstraint = (identity: string, range: string): void => {
    const ranges = constraints.get(identity) ?? [];
    if (!ranges.includes(range)) ranges.push(range);
    constraints.set(identity, ranges);
  };

  let selected = new Map<string, ReleaseGraphNode>();
  // 触发重选的边数上界即图中的边数；加 1 个收尾轮，超出即视为不收敛。
  const maxAttempts = 1 + Object.keys(roots).length + 64;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ranges = new Map<string, string[]>();
    for (const [identity, seeded] of constraints) ranges.set(identity, [...seeded]);
    selected = new Map<string, ReleaseGraphNode>();

    const visit = async (identity: string, range: string, path: string[]): Promise<void> => {
      if (validateReleaseDependencyTarget(identity)) {
        throw new ReleaseGraphError('releaseDependencyTargetInvalid', { identity });
      }
      if (path.includes(identity)) {
        throw new ReleaseGraphError('releaseDependencyCycle', {
          path: [...path, identity].join(' -> ')
        });
      }
      const allRanges = ranges.get(identity) ?? [];
      if (!allRanges.includes(range)) allRanges.push(range);
      ranges.set(identity, allRanges);

      const existing = selected.get(identity);
      if (existing) {
        if (semver.satisfies(existing.version, range)) return;
        // 已选版本不再满足：把范围固化为约束并整轮重来，避免残留旧子图范围。
        throw new ResolveRestart(identity, range);
      }
      if (!rangesIntersect(allRanges)) {
        throw new ReleaseGraphError('releaseDependencyRangesDoNotIntersect', {
          identity,
          ranges: [...new Set(allRanges)].join(', ')
        });
      }
      const versions = await source.listVersions(identity);
      const chosen = highestSatisfyingAllRanges(versions, allRanges);
      if (!chosen) {
        throw new ReleaseGraphError(
          versions.length === 0
            ? 'releaseDependencyNoRelease'
            : 'releaseDependencyNoSatisfyingVersion',
          { identity }
        );
      }
      const node = await source.load(identity, chosen);
      selected.set(identity, node);
      for (const [dependency, dependencyRange] of Object.entries(node.dependencies)) {
        await visit(dependency, dependencyRange, [...path, identity]);
      }
    };

    try {
      const rootPath = options.rootIdentity ? [options.rootIdentity] : [];
      for (const [identity, range] of Object.entries(roots)) {
        await visit(identity, range, rootPath);
      }
    } catch (error) {
      if (error instanceof ResolveRestart) {
        addConstraint(error.identity, error.range);
        continue;
      }
      throw error;
    }

    // 可达性收敛：以根为起点按最终选定节点展开；重选后不再可达的旧边排除在外。
    const reachable = new Map<string, ReleaseGraphNode>();
    const queue = Object.keys(roots);
    while (queue.length > 0) {
      const identity = queue.shift()!;
      if (reachable.has(identity)) continue;
      const node = selected.get(identity);
      if (!node) continue;
      reachable.set(identity, node);
      for (const dependency of Object.keys(node.dependencies)) {
        if (selected.has(dependency)) queue.push(dependency);
      }
    }

    if (options.rootVisibility === 'public') {
      for (const node of reachable.values()) {
        if (node.visibility !== 'public') {
          throw new ReleaseGraphError('releaseDependencyPublicChainMustBePublic', {
            identity: node.identity
          });
        }
      }
    }

    const lock: Record<string, ReleaseLockEntry> = {};
    for (const [identity, node] of reachable) {
      lock[identity] = {
        skillId: node.skillId,
        version: node.version,
        checksum: node.checksum
      };
    }
    return lock;
  }

  throw new ReleaseGraphError('releaseDependencyRangesDoNotIntersect', {
    identity: Object.keys(roots).join(', '),
    ranges: 'resolve did not converge'
  });
}
