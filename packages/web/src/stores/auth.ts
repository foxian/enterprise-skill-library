import { defineStore } from 'pinia';
// 深引入纯类型模块，避免把 @esl/core 的 Node 依赖打进浏览器包
import type { OrgIdentity } from '@esl/core/dist/org/standing-teams.js';

/**
 * 组织隶属关系（ADR-0036）。组织内没有角色——`identity` 是由常设团队成员身份
 * **推导**出的三档身份，逐组织成立，不是全局角色。
 */
export interface SessionOrganization {
  org: string;
  identity: OrgIdentity;
  /** 便捷判据：是否所有者成员。治理入口以它为准。 */
  isOwnerMember: boolean;
}

const ORG_IDENTITIES: readonly string[] = ['ordinary', 'managing', 'owner'];

/**
 * 管理后台会话。平台角色只有两个（ADR-0033），会话因此只有两个维度：
 * 是不是平台管理员，以及在每个组织里是什么身份（三档，ADR-0036）。
 */
export interface AuthSession {
  token: string;
  username: string;
  isPlatformAdmin: boolean;
  organizations: SessionOrganization[];
}

const STORAGE_KEY = 'esl-admin-session';

/** 超管控制台与个人控制台各自的落地页（ADR-0035）。 */
export const PLATFORM_ADMIN_HOME = '/admin/super/dashboard';
export const PERSONAL_HOME = '/admin/me/overview';

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as AuthSession;
    // 旧会话直接丢弃走重新登录——比把旧语义当新语义用更安全。历次形态：
    // ① 三视角的 role/org（ADR-0032 之前）；② 两档的 isOrgManager（ADR-0036 之前）。
    if (
      session?.token &&
      session.username &&
      typeof session.isPlatformAdmin === 'boolean' &&
      Array.isArray(session.organizations) &&
      session.organizations.every(
        (membership) =>
          typeof membership?.org === 'string' &&
          ORG_IDENTITIES.includes(membership.identity) &&
          typeof membership.isOwnerMember === 'boolean'
      )
    ) {
      return session;
    }
  } catch {
    // 损坏的本地会话直接丢弃，走重新登录
  }
  return null;
}

export const useAuthStore = defineStore('auth', {
  state: (): { session: AuthSession | null } => ({
    session: loadSession()
  }),
  getters: {
    isLoggedIn: (state): boolean => state.session !== null,
    token: (state): string | null => state.session?.token ?? null,
    username: (state): string | null => state.session?.username ?? null,
    isPlatformAdmin: (state): boolean => state.session?.isPlatformAdmin ?? false,
    organizations: (state): SessionOrganization[] => state.session?.organizations ?? [],
    homePath(state): string {
      if (!state.session) {
        return '/admin/login';
      }
      return state.session.isPlatformAdmin ? PLATFORM_ADMIN_HOME : PERSONAL_HOME;
    }
  },
  actions: {
    establish(session: AuthSession): void {
      this.session = session;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    },
    logout(): void {
      this.session = null;
      localStorage.removeItem(STORAGE_KEY);
    },
    /** 我在该组织的身份；不在该组织返回 null。 */
    identityOf(org: string): OrgIdentity | null {
      return this.organizations.find((membership) => membership.org === org)?.identity ?? null;
    },
    /** 该组织在本会话中是否可治理（所有者成员身份，逐组织判定）。 */
    isOwnerMember(org: string): boolean {
      return this.organizations.some((membership) => membership.org === org && membership.isOwnerMember);
    }
  }
});
