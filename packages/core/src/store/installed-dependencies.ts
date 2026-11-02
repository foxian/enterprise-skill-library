import semver from 'semver';

import {
  installManifestKey,
  loadInstallManifest,
  readInstalledDependencies,
  type InstallManifest,
  type InstallManifestSkill
} from './skill-store.js';
import { loadSkillsJson } from './skills-json.js';

export interface InstalledGraphNode {
  key: string;
  identity: string;
  entry: InstallManifestSkill;
  dependencies: Record<string, string>;
}

export interface InstalledGraph {
  manifest: InstallManifest;
  /** 项目直接声明的技能身份（Skill Dependency Manifest）。 */
  direct: Set<string>;
  instances: Record<string, string>;
  /** 安装清单键（identity#instanceId）→ 已装副本及其声明的发布依赖。 */
  nodes: Map<string, InstalledGraphNode>;
}

/** 从项目清单与安装清单还原本机已装图：直接根、各副本的实际依赖声明与实例。 */
export async function loadInstalledGraph(
  dependencyRoot: string,
  storeRoot: string
): Promise<InstalledGraph> {
  const manifest = await loadInstallManifest(storeRoot);
  let direct = new Set<string>();
  let instances: Record<string, string> = {};
  try {
    const skillsJson = await loadSkillsJson(dependencyRoot);
    direct = new Set(Object.keys(skillsJson.skills));
    instances = { ...(skillsJson.instances ?? {}) };
  } catch {
    // 没有项目清单时仍可从安装清单读取（全局场景由调用方传入 Store 根）。
  }

  const nodes = new Map<string, InstalledGraphNode>();
  for (const [key, entry] of Object.entries(manifest.skills)) {
    const identity = entry.identity ?? key;
    nodes.set(key, {
      key,
      identity,
      entry,
      dependencies: readInstalledDependencies(storeRoot, identity, entry.instanceId)
    });
  }
  return { manifest, direct, instances, nodes };
}

/**
 * 按身份（与可选实例）在已装图中找副本。实例隔离：依赖沿父副本的实例展开，
 * 不从其他实例的同名副本借位（ADR-0071）。
 */
export function findGraphNode(
  graph: InstalledGraph,
  identity: string,
  instanceId?: string | null
): InstalledGraphNode | undefined {
  if (instanceId) {
    const exact = graph.nodes.get(installManifestKey(identity, instanceId));
    if (exact) return exact;
  }
  for (const node of graph.nodes.values()) {
    if (
      node.identity === identity &&
      (!instanceId || node.entry.instanceId === undefined || node.entry.instanceId === instanceId)
    ) {
      return node;
    }
  }
  return undefined;
}

/**
 * 从剩余根出发，沿已装副本的发布依赖展开，得到「仍被需要」的身份集合及其
 * 需要它的根集合。根是项目直接声明的技能；excludeRoot 用于计算「去掉目标
 * 之后」的图（卸载/清理候选）。
 */
export async function computeRequiredIdentities(
  dependencyRoot: string,
  storeRoot: string,
  options: { excludeRoot?: string } = {}
): Promise<Map<string, Set<string>>> {
  const graph = await loadInstalledGraph(dependencyRoot, storeRoot);
  const needers = new Map<string, Set<string>>();
  for (const root of reachableNodes(graph, options.excludeRoot ? [options.excludeRoot] : [])) {
    for (const node of root.nodes) {
      let needersOfIdentity = needers.get(node.identity);
      if (!needersOfIdentity) {
        needersOfIdentity = new Set();
        needers.set(node.identity, needersOfIdentity);
      }
      needersOfIdentity.add(root.root);
    }
  }
  return needers;
}

interface ReachableRoot {
  root: string;
  nodes: Set<InstalledGraphNode>;
}

function reachableNodes(graph: InstalledGraph, excludeRoots: readonly string[]): ReachableRoot[] {
  const excluded = new Set(excludeRoots);
  const result: ReachableRoot[] = [];
  for (const root of graph.direct) {
    if (excluded.has(root)) continue;
    const start = findGraphNode(graph, root, graph.instances[root]);
    const seen = new Set<InstalledGraphNode>();
    const queue: InstalledGraphNode[] = start ? [start] : [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const dependency of Object.keys(node.dependencies)) {
        const child = findGraphNode(graph, dependency, node.entry.instanceId);
        if (child) queue.push(child);
      }
    }
    result.push({ root, nodes: seen });
  }
  return result;
}

/**
 * 主动删除仍被其他技能需要的目标时，列出直接或传递依赖它的技能（不含目标
 * 自己）。只沿依赖方向走到目标为止：目标的下游不因目标缺失而「受影响」。
 */
export async function computeDependencyImpact(
  dependencyRoot: string,
  storeRoot: string,
  target: string
): Promise<string[]> {
  const graph = await loadInstalledGraph(dependencyRoot, storeRoot);
  const affected = new Set<string>();

  const visit = (node: InstalledGraphNode, path: string[]): void => {
    if (node.identity === target) {
      for (const ancestor of path) {
        if (ancestor !== target) affected.add(ancestor);
      }
      return;
    }
    for (const dependency of Object.keys(node.dependencies)) {
      const child = findGraphNode(graph, dependency, node.entry.instanceId);
      if (!child || path.includes(dependency)) continue;
      visit(child, [...path, node.identity]);
    }
  };

  for (const root of graph.direct) {
    if (root === target) continue;
    const start = findGraphNode(graph, root, graph.instances[root]);
    if (start) visit(start, []);
  }
  return [...affected];
}

export interface CleanupCandidate {
  identity: string;
  instanceId?: string;
  version: string;
  /** 该副本声明的发布依赖，用于校验部分清理不会让保留候选缺少依赖。 */
  dependencies?: Record<string, string>;
}

export interface ProtectedDependency {
  identity: string;
  dependencies: Record<string, string>;
}

export interface CleanupPlan {
  /** 可清理的孤儿副本；默认全部保留，由用户选择。 */
  candidates: CleanupCandidate[];
  /** 仍保留但不是清理候选的副本（如用户保留项），清理不能让其缺少依赖。 */
  protectedDependents: ProtectedDependency[];
}

/**
 * 声明的依赖方范围是否仍覆盖目标新版本；越界只提示，不阻止主动升级。
 */
export async function findOutOfRangeDependents(
  dependencyRoot: string,
  storeRoot: string,
  target: string,
  version: string
): Promise<string[]> {
  const graph = await loadInstalledGraph(dependencyRoot, storeRoot);
  const affected = new Set<string>();
  for (const node of graph.nodes.values()) {
    const range = node.dependencies[target];
    if (range && semver.validRange(range) !== null && !semver.satisfies(version, range)) {
      affected.add(node.identity);
    }
  }
  return [...affected];
}

/**
 * 部分清理的安全校验（ADR-0072）：未删除的副本如果依赖了已选中的候选，
 * 删掉被依赖项会让它缺少依赖。protectedDependents 覆盖用户保留项等不在
 * 候选列表中的副本。此处的判断是清理决策的核心规则，CLI 不重复实现。
 */
export function findCleanupImpact(
  candidates: readonly CleanupCandidate[],
  selected: readonly string[],
  protectedDependents: readonly ProtectedDependency[] = []
): string[] {
  if (selected.length === 0) return [];
  const selectedSet = new Set(selected);
  const retained = [
    ...candidates.filter((candidate) => !selectedSet.has(candidate.identity)),
    ...protectedDependents
  ];
  const removed = new Set(selected);
  const affected = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of retained) {
      if (affected.has(candidate.identity)) continue;
      const dependencies = Object.keys(candidate.dependencies ?? {});
      if (dependencies.some((dependency) => removed.has(dependency))) {
        affected.add(candidate.identity);
        removed.add(candidate.identity);
        changed = true;
      }
    }
  }
  return [...affected];
}

/**
 * 卸载/更新后的清理计划：候选是不属于任何剩余根可达图、不是项目直接声明、
 * 也没有被用户保留的副本；protectedDependents 是仍被保留但不在候选中的副本，
 * 用于校验部分清理不会让它们缺少依赖。默认全部不勾选由调用方决定是否删除。
 */
export async function computeCleanupPlan(input: {
  dependencyRoot: string;
  storeRoot: string;
  /** 计算时视为已移除的直接根（卸载目标）。 */
  excludeRoots?: readonly string[];
}): Promise<CleanupPlan> {
  const graph = await loadInstalledGraph(input.dependencyRoot, input.storeRoot);
  const reachable = new Set<string>();
  for (const root of reachableNodes(graph, input.excludeRoots ?? [])) {
    for (const node of root.nodes) reachable.add(node.key);
  }

  const candidates: CleanupCandidate[] = [];
  const protectedDependents: ProtectedDependency[] = [];
  for (const node of graph.nodes.values()) {
    if (node.entry.retained === true) {
      protectedDependents.push({
        identity: node.identity,
        dependencies: { ...node.dependencies }
      });
      continue;
    }
    if (graph.direct.has(node.identity)) continue;
    if (reachable.has(node.key)) continue;
    candidates.push({
      identity: node.identity,
      ...(node.entry.instanceId ? { instanceId: node.entry.instanceId } : {}),
      version: node.entry.version,
      dependencies: { ...node.dependencies }
    });
  }
  return { candidates, protectedDependents };
}

/** 仅需要候选列表时的便捷入口。 */
export async function computeCleanupCandidates(input: {
  dependencyRoot: string;
  storeRoot: string;
  excludeRoots?: readonly string[];
}): Promise<CleanupCandidate[]> {
  return (await computeCleanupPlan(input)).candidates;
}

