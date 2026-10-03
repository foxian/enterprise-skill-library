import fs from 'node:fs';
import path from 'node:path';
import { loadSkillsJson, skillSourceRelativeDir } from '@esl/core';

/**
 * 从剩余根出发，沿每个已装技能 `skill.json` 的发布依赖展开，得到「仍被需要的
 * 身份」集合（ADR-0056 的回收依据）。返回 identity → 需要它的根身份集合，
 * 供卸载失败时指出引用方。根取自项目 `.skills.json` 的直接依赖。
 */
export async function computeRequiredIdentities(
  dependencyRoot: string,
  storeRoot: string,
  options: { excludeRoot?: string } = {}
): Promise<Map<string, Set<string>>> {
  const needers = new Map<string, Set<string>>();
  let roots: string[] = [];
  try {
    roots = Object.keys((await loadSkillsJson(dependencyRoot)).skills);
  } catch {
    return needers;
  }
  if (options.excludeRoot) {
    roots = roots.filter((root) => root !== options.excludeRoot);
  }

  for (const root of roots) {
    const queue = [root];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const identity = queue.shift()!;
      if (seen.has(identity)) continue;
      seen.add(identity);
      let needersOfIdentity = needers.get(identity);
      if (!needersOfIdentity) {
        needersOfIdentity = new Set();
        needers.set(identity, needersOfIdentity);
      }
      needersOfIdentity.add(root);
      const dependencies = readInstalledDependencies(storeRoot, identity);
      for (const dep of Object.keys(dependencies)) queue.push(dep);
    }
  }
  return needers;
}

/**
 * 已装副本的发布依赖：普通安装读生成的 `skill.json`；Skill Source Link 的 Store
 * 位置指向源码目录、通常没有 `skill.json`，回退读源码的 `release.json`。两者都
 * 缺失或不可读时视为空（无发布依赖）。
 */
export function readInstalledDependencies(
  storeRoot: string,
  identity: string
): Record<string, string> {
  const directory = path.join(storeRoot, skillSourceRelativeDir(identity));
  for (const file of ['skill.json', 'release.json']) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      // skill.json 一定带 dependencies 字段；release.json 同样。命中即返回。
      return parsed.dependencies ?? {};
    } catch {
      // 试下一个文件。
    }
  }
  return {};
}
