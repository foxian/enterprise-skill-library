import type { GiteaService } from './gitea.js';
import type { SkillRecord } from '../db/database.js';
import { isOwnerMemberOf, isManagingMemberOf } from './organization-membership.js';

// ADR-0025 三档权限:Read/Write/Manage,Manage 档隐含读与写。
export type SkillAccessLevel = 'none' | 'read' | 'write' | 'manage';

// 从技能记录的 gitRepoPath(如 "acme/reviewer")解析 Git Backend 仓库属主与仓库名。
export function skillRepo(skill: SkillRecord): { owner: string; name: string } {
  const slash = skill.gitRepoPath.indexOf('/');
  return {
    owner: skill.gitRepoPath.slice(0, slash),
    name: skill.gitRepoPath.slice(slash + 1)
  };
}

// 组织级技能管理权（ADR-0038）：所有者成员或 org-managers 成员。scope 不是组织
// （个人技能）时按无组织级权限处理，判定统一走共享实现。
async function isOrgSkillManager(giteaService: GiteaService, org: string, username: string): Promise<boolean> {
  return (await isOwnerMemberOf(giteaService, org, username)) ||
    (await isManagingMemberOf(giteaService, org, username));
}

export async function getAccessLevel(
  giteaService: GiteaService,
  skill: SkillRecord,
  username: string | undefined
): Promise<SkillAccessLevel> {
  if (!username) return 'none';
  if (username === skill.owner || skill.maintainers.includes(username)) return 'manage';
  if (giteaService.adminUsername && username === giteaService.adminUsername) return 'manage';
  if (skill.scope !== username && (await isOrgSkillManager(giteaService, skill.scope, username))) {
    return 'manage';
  }
  // public 是 Read 基线而不是权限上限：继续合并团队与个人授权，使 write/manage
  // 来源能够提升最终权限。仓库缺失或查询失败时仍保留 public 的可读兜底。
  const publicRead = skill.visibility === 'public';
  // 没有权限 API 的 Git Backend 无法过滤权限，保留旧行为的可读基线。
  const hasPermissionSupport =
    typeof giteaService.listRepoTeams === 'function' || typeof giteaService.isCollaborator === 'function';
  if (!hasPermissionSupport) return 'read';
  const repo = skillRepo(skill);
  let level: SkillAccessLevel = publicRead ? 'read' : 'none';
  try {
    if (typeof giteaService.listRepoTeams === 'function' && typeof giteaService.isTeamMember === 'function') {
      for (const team of await giteaService.listRepoTeams(repo.owner, repo.name)) {
        if (!(await giteaService.isTeamMember(team.id, username))) continue;
        if (team.permission === 'admin' || team.permission === 'owner') return 'manage';
        if (team.permission === 'write') level = 'write';
        else if (level === 'none') level = 'read';
      }
    }
    if (typeof giteaService.getCollaboratorPermission === 'function') {
      const permission = await giteaService.getCollaboratorPermission(repo.owner, repo.name, username);
      if (permission === 'admin' || permission === 'owner') return 'manage';
      if (permission === 'write') level = 'write';
      else if (permission === 'read' && level === 'none') level = 'read';
    }
  } catch (error) {
    if (publicRead) return level;
    throw error;
  }
  return level;
}
// 管理权判定(ADR-0025):publish、rename、archive、权限配置等技能管理操作统一守门。
export async function canManageSkill(
  giteaService: GiteaService,
  skill: SkillRecord,
  username: string | undefined
): Promise<boolean> {
  return (await getAccessLevel(giteaService, skill, username)) === 'manage';
}

export async function hasReadAccess(
  giteaService: GiteaService,
  skill: SkillRecord,
  username: string | undefined
): Promise<boolean> {
  return (await getAccessLevel(giteaService, skill, username)) !== 'none';
}
