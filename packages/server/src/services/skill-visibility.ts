import { isAnonymousConsumable } from '@esl/core';
import type { SkillRecord, SkillRepository } from '../db/database.js';

/**
 * 匿名可装性（ADR-0073）不是根技能一个人的事：匿名访客拿到根包后还要逐个下载
 * Release Dependency Lock 里的依赖，任何一环不是 anonymous 都会在安装途中失败。
 * 因此切换档位与发布新版本都要用「已冻锁」而不是当前清单去校验，才能和实际
 * 安装路径一致：冻锁记录的是这个版本真正带走的传递依赖。
 */

interface LockEntry {
  skillId?: string;
}

/** 读取一个 Release 的冻锁；老数据缺失或损坏时返回空对象。 */
function releaseLock(release: { dependencyLock?: unknown }): Record<string, LockEntry> {
  const lock = release.dependencyLock;
  if (!lock || typeof lock !== 'object') return {};
  return lock as Record<string, LockEntry>;
}

/**
 * 返回该技能所有仍可安装的已发布版本里，依赖链中不是 anonymous 的技能身份。
 * 结果去重且排序，供切换档位的 409 响应直接展示。
 */
export function findNonAnonymousChainDependencies(
  repository: SkillRepository,
  skill: SkillRecord
): string[] {
  const conflicts = new Set<string>();
  for (const release of repository.getReleases(skill.name)) {
    const lock = releaseLock(release);
    for (const [identity, entry] of Object.entries(lock)) {
      const dependency = entry?.skillId ? repository.getSkillById(entry.skillId) : undefined;
      // 身份缺失或已不可查时同样按冲突处理：无法证明匿名可装。
      if (!dependency || !isAnonymousConsumable(dependency.visibility)) {
        conflicts.add(dependency?.name ?? identity);
      }
    }
    // 清单声明了依赖却没有对应冻锁条目，说明这条边无法按匿名路径复核；
    // 宁可阻止切换，也不承诺一个未经验证的依赖链。
    const manifestDependencies = (release.releaseManifest as { dependencies?: Record<string, string> } | null)
      ?.dependencies;
    for (const identity of Object.keys(manifestDependencies ?? {})) {
      if (!(identity in lock)) conflicts.add(identity);
    }
  }
  return [...conflicts].sort();
}

/**
 * 返回仍以 anonymous 档位发布的技能中，冻锁引用了目标 Skill ID 的技能身份。
 * 收紧目标技能的可见性会当场破坏这些技能的匿名安装承诺，因此必须先阻止。
 */
export function findAnonymousDependents(
  repository: SkillRepository,
  skillId: string | undefined
): string[] {
  if (!skillId) return [];
  return repository
    .findSkillDependents(skillId)
    .filter((name) => {
      const dependent = repository.getSkill(name);
      return dependent ? isAnonymousConsumable(dependent.visibility) : false;
    })
    .sort();
}
