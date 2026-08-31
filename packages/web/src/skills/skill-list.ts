import { apiRequest } from '../api/client';

export interface PermissionMatrix {
  scope: string;
  skillName: string;
  sharedAllRead: boolean;
  sharedAllWrite: boolean;
  teams: Array<{ id: number; name: string; permission: string }>;
  members: Array<{ username: string; permission: string }>;
}

export interface TeamOption {
  id: number;
  name: string;
  permission: string;
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

export interface ShareState {
  key: 'private' | 'all-read' | 'all-write' | 'custom';
  text: string;
  tagType: 'info' | 'success' | 'warning' | 'primary';
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
