import { apiRequest } from '../api/client';

export interface PermissionMatrix {
  scope: string;
  skillName: string;
  sharedAllRead: boolean;
  sharedAllWrite: boolean;
  sharedAllManage: boolean;
  teams: Array<{ id: number; name: string; permission: string; display_name?: string }>;
  members: Array<{ username: string; permission: string }>;
}

// 技能管理页面的只读技能上下文(CONTEXT:技能管理页面):描述、发布状态、
// 最新与全部 Skill Release;由 permissions GET 响应的 skill 字段携带。
export interface ReleaseView {
  version: string;
  createdAt?: string;
  notes?: string;
  sourceCommit: string;
  createdBy: string;
}

export interface SkillContext {
  name: string;
  description: string;
  status?: string;
  createdBy: string;
  latestRelease?: { version: string; createdAt?: string; notes?: string };
  releases: ReleaseView[];
}

export type PermissionsResponse = PermissionMatrix & { skill?: SkillContext };

export interface TeamOption {
  id: number;
  name: string;
  permission: string;
  display_name?: string;
}

export interface MemberOption {
  username: string;
}

export interface SkillRecordView {
  name: string;
  scope: string;
  skillName: string;
  createdBy: string;
  owner: string;
}

export interface SkillSummary extends SkillRecordView {
  matrix: PermissionMatrix;
}

// 角色化技能清单(ADR-0025):服务端按调用方身份过滤(含未发布技能)并标注关系——
// managed=持有管理权,shared=可读/可写但无管理权。
export interface SkillInventoryItem {
  name: string;
  scope: string;
  skillName: string;
  description?: string;
  createdBy: string;
  owner: string;
  status?: string;
  access: 'read' | 'write' | 'manage';
  relation: 'managed' | 'shared';
}

export type SkillInventorySummary = SkillInventoryItem & { matrix?: PermissionMatrix };

export function accessText(access: string): string {
  if (access === 'manage') return '管理';
  return access === 'write' ? '读写' : '只读';
}

export function statusText(status?: string): string {
  return status === 'active-published' || status === 'published' ? '已发布' : '未发布';
}

// 读取角色化技能清单;共享状态矩阵只对持有管理权的技能可读,其余以 access 呈现。
export async function loadSkillInventorySummaries(): Promise<SkillInventorySummary[]> {
  const items = await apiRequest<SkillInventoryItem[]>('/api/skills/inventory');
  return Promise.all(
    items.map(async (item) => {
      if (item.relation !== 'managed') {
        return { ...item };
      }
      try {
        const matrix = await apiRequest<PermissionMatrix>(
          `/api/skills/${encodeURIComponent(item.scope)}/${encodeURIComponent(item.skillName)}/permissions`
        );
        return { ...item, matrix };
      } catch {
        // 矩阵读取失败时保持未标注状态,由调用方按默认私有展示
        return { ...item };
      }
    })
  );
}

export interface ShareState {
  key: 'private' | 'all-read' | 'all-write' | 'all-manage' | 'custom';
  text: string;
  tagType: 'info' | 'success' | 'warning' | 'danger' | 'primary';
}

// 组织管理员读全组织技能；成员读自己可访问的技能后按创建者过滤
export async function loadSkillSummaries(filter: (skill: SkillRecordView) => boolean): Promise<SkillSummary[]> {
  const skills = (await apiRequest<SkillRecordView[]>('/api/skills/search?q=')).filter(filter);
  return Promise.all(
    skills.map(async (skill) => {
      let matrix: PermissionMatrix = {
        scope: skill.scope,
        skillName: skill.skillName,
        sharedAllRead: false,
        sharedAllWrite: false,
        sharedAllManage: false,
        teams: [],
        members: []
      };
      try {
        matrix = await apiRequest<PermissionMatrix>(
          `/api/skills/${encodeURIComponent(skill.scope)}/${encodeURIComponent(skill.skillName)}/permissions`
        );
      } catch {
        // 无权限矩阵读取权限的技能保持“状态未知”的私有展示
      }
      return { ...skill, matrix };
    })
  );
}

export function deriveShareState(matrix: PermissionMatrix): ShareState {
  // ADR-0026 组织共享级别:三档互斥,按档位由高到低判定
  if (matrix.sharedAllManage) {
    return { key: 'all-manage', text: '全员管理', tagType: 'danger' };
  }
  if (matrix.sharedAllWrite) {
    return { key: 'all-write', text: '全员读写', tagType: 'warning' };
  }
  if (matrix.sharedAllRead) {
    return { key: 'all-read', text: '全员只读', tagType: 'success' };
  }
  // members 中至少包含创建者本人，超出即视为自定义授权
  if (matrix.teams.length > 0 || matrix.members.length > 1) {
    return { key: 'custom', text: '自定义', tagType: 'primary' };
  }
  return { key: 'private', text: '仅创建者', tagType: 'info' };
}
