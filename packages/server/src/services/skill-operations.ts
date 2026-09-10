import type { SkillRepository } from '../db/database.js';
import type { GiteaService } from './gitea.js';

export interface SkillCreationPayload {
  name: string;
  scope: string;
  skillName: string;
  description: string;
  visibility: string;
  username: string;
}

export interface SkillOperationDeps {
  giteaService: GiteaService;
  skillRepository: SkillRepository;
}

// 技能仓库创建与 Skill Identity 登记的幂等执行:
// - 身份已登记时直接返回(重复请求经幂等键收敛到同一 Operation,不重复建仓库);
// - 仓库已存在但身份未登记时复用该仓库——它是本 Operation 上次尝试遗留的
//   孤儿,幂等键与确定性仓库名构成 Resource Provenance;
// - 登记失败时补偿删除本次创建的仓库,不留不可见孤儿资源。
export async function executeSkillCreation(deps: SkillOperationDeps, payload: SkillCreationPayload): Promise<void> {
  const { giteaService, skillRepository } = deps;
  if (skillRepository.getSkill(payload.name)) {
    return;
  }
  const repoName = `${payload.scope}_${payload.skillName}`;
  let createdFullName: string | undefined;
  try {
    const existingRepo = typeof giteaService.getRepo === 'function'
      ? await giteaService.getRepo(payload.scope, repoName)
      : null;
    if (existingRepo) {
      // 采纳已有仓库:它可能是本 Operation 上次尝试遗留的孤儿。
      // 采纳的仓库不是本次创建的资源,后续失败不参与补偿删除。
      await skillRepository.createServerSkill({
        name: payload.name,
        scope: payload.scope,
        skillName: payload.skillName,
        description: payload.description,
        createdBy: payload.username,
        owner: 'platform',
        maintainers: [payload.username],
        visibility: payload.visibility,
        gitRepoPath: existingRepo.full_name,
        status: 'active-published'
      });
      return;
    }
    const created = await giteaService.createOrganizationRepo(
      payload.scope,
      repoName,
      payload.visibility === 'private'
    );
    createdFullName = created.full_name;
    skillRepository.createServerSkill({
      name: payload.name,
      scope: payload.scope,
      skillName: payload.skillName,
      description: payload.description,
      createdBy: payload.username,
      owner: 'platform',
      maintainers: [payload.username],
      visibility: payload.visibility,
      gitRepoPath: createdFullName,
      status: 'active-published'
    });
  } catch (error) {
    // Resource Provenance:仅补偿本次操作创建且身份未登记的仓库;
    // 补偿本身失败时保留现场,失败 Operation 供管理员重试或人工清理。
    if (createdFullName && !skillRepository.getSkill(payload.name) && typeof giteaService.deleteRepo === 'function') {
      try {
        await giteaService.deleteRepo(payload.scope, repoName);
      } catch {
        // 补偿失败保留现场;原始失败原因优先上抛。
      }
    }
    throw error;
  }
}

export interface PermissionChangePayload {
  skillName: string;
  scope: string;
  repoOwner: string;
  repoName: string;
  action: string;
  teamId?: number;
  username?: string;
  permission?: string;
  skillOwner?: string;
}

// 三个全员默认团队:组织共享级别互斥时,设置某档只保留该档团队挂载。
const ALL_SHARE_TEAM_NAMES = new Set(['all-readers', 'all-writers', 'all-managers']);

// 权限变更执行:Gitea 是权限的唯一事实来源,这里只执行变更,不建立本地镜像。
export async function executePermissionChange(
  deps: Pick<SkillOperationDeps, 'giteaService'>,
  payload: PermissionChangePayload
): Promise<void> {
  const { giteaService } = deps;
  switch (payload.action) {
    case 'share_all_read':
    case 'share_all_write':
    case 'share_all_manage':
      await giteaService.addTeamRepo(payload.teamId!, payload.repoOwner, payload.repoName);
      // 组织共享级别互斥(ADR-0026):设置更高级别(或同档重置)时,卸载其余
      // 已挂载的全员团队,保持单一档位语义。自定义团队授权与其正交,不受影响。
      if (typeof giteaService.listRepoTeams === 'function') {
        const mountActionName =
          payload.action === 'share_all_read' ? 'all-readers' : payload.action === 'share_all_write' ? 'all-writers' : 'all-managers';
        for (const team of await giteaService.listRepoTeams(payload.repoOwner, payload.repoName)) {
          if (team.name !== mountActionName && ALL_SHARE_TEAM_NAMES.has(team.name)) {
            await giteaService.removeTeamRepo(team.id, payload.repoOwner, payload.repoName);
          }
        }
      }
      break;
    case 'add_team':
      await giteaService.addTeamRepo(payload.teamId!, payload.repoOwner, payload.repoName);
      break;
    case 'remove_team':
      await giteaService.removeTeamRepo(payload.teamId!, payload.repoOwner, payload.repoName);
      break;
    case 'add_member':
      // ADR-0025 三档:ESL 的 manage 档映射为 Gitea admin 级协作者。
      await giteaService.addCollaborator(
        payload.repoOwner,
        payload.repoName,
        payload.username!,
        payload.permission === 'manage' ? 'admin' : (payload.permission as 'read' | 'write')
      );
      break;
    case 'remove_member':
      await giteaService.removeCollaborator(payload.repoOwner, payload.repoName, payload.username!);
      break;
    case 'reset_to_private': {
      if (typeof giteaService.listRepoTeams === 'function') {
        for (const team of await giteaService.listRepoTeams(payload.repoOwner, payload.repoName)) {
          await giteaService.removeTeamRepo(team.id, payload.repoOwner, payload.repoName);
        }
      }
      if (typeof giteaService.listCollaborators === 'function') {
        for (const member of await giteaService.listCollaborators(payload.repoOwner, payload.repoName)) {
          if (member.username === payload.skillOwner) continue;
          await giteaService.removeCollaborator(payload.repoOwner, payload.repoName, member.username);
        }
      }
      break;
    }
    default:
      throw new Error(`Unknown permission action: ${payload.action}`);
  }
}
