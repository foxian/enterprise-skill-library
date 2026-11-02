/**
 * 逐技能可见性（ADR-0032 / ADR-0073）：消费范围从窄到宽依次为
 * private（仅被授权者）、public（平台已登录用户）、anonymous（任何人，含匿名访客）。
 * 它是消费授权，不是协作授权——anonymous 不会开放源码仓库、未发布内容或反馈区。
 */
export const SKILL_VISIBILITIES = ['private', 'public', 'anonymous'] as const;

export type SkillVisibility = (typeof SKILL_VISIBILITIES)[number];

export function isSkillVisibility(value: unknown): value is SkillVisibility {
  return typeof value === 'string' && (SKILL_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * 已登录用户的读基线：public 与 anonymous 都对所有已登录用户开放。private
 * 仍需查询团队与显式授权。调用方必须先确认调用者已登录；匿名访客的路径单独
 * 用 isAnonymousConsumable 判定，避免把「登录」误当成必要条件。
 */
export function isSignedInReadable(visibility: string): boolean {
  return visibility === 'anonymous' || visibility === 'public';
}

/** 匿名访客（无登录身份）可消费的档位只有 anonymous。 */
export function isAnonymousConsumable(visibility: string): boolean {
  return visibility === 'anonymous';
}

/** 把数据库里的自由字符串收口为已知档位；未知值按最窄的 private 处理。 */
export function normalizeSkillVisibility(visibility: string | null | undefined): SkillVisibility {
  return isSkillVisibility(visibility) ? visibility : 'private';
}
