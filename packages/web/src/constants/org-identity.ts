import type { OrgIdentity } from '@esl/core/dist/org/standing-teams.js';

// 组织内三档身份（ADR-0038）的展示词与配色。身份由常设团队成员身份**推导**，
// 不是角色；这里是界面文案的单一来源——我的组织、概览、成员管理、超管组织详情
// 四处共用，避免同一档在不同页面叫不同名字。

const IDENTITY_KEYS: Record<OrgIdentity, string> = {
  ordinary: 'orgIdentity.ordinary',
  managing: 'orgIdentity.managing',
  owner: 'orgIdentity.owner'
};

export const IDENTITY_TAG_TYPES: Record<OrgIdentity, 'primary' | 'warning' | 'info'> = {
  ordinary: 'info',
  managing: 'warning',
  owner: 'primary'
};

const PROMOTION_KEYS: Record<'managing' | 'owner', string> = {
  managing: 'orgIdentity.promoteManaging',
  owner: 'orgIdentity.promoteOwner'
};

// 模板里表格的 row 是 any，直接拿它索引 Record 会触发 noImplicitAny；收口在这里。
export function identityLabel(identity: string): string {
  return IDENTITY_KEYS[identity as OrgIdentity] ?? identity;
}

export function identityTagType(identity: string): 'primary' | 'warning' | 'info' {
  return IDENTITY_TAG_TYPES[identity as OrgIdentity] ?? 'info';
}

export function promotionLabel(identity: string): string {
  return PROMOTION_KEYS[identity as 'managing' | 'owner'] ?? identity;
}
