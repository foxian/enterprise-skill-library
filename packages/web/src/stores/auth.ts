import { defineStore } from 'pinia';

/**
 * 组织隶属关系（ADR-0033）。组织内没有角色——`isOrgManager` 就是「是该组织
 * 管理团队（= Gitea Owners）成员」这一团队身份，它逐组织成立，不是全局角色。
 */
export interface SessionOrganization {
  org: string;
  isOrgManager: boolean;
}

/**
 * 管理后台会话。平台角色只有两个（ADR-0033），会话因此只有两个维度：
 * 是不是平台管理员，以及在每个组织里是不是组织管理团队成员。
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
    // 旧会话带 role/org 而无 isPlatformAdmin（ADR-0032 的三视角形态），直接丢弃
    // 走重新登录——比把旧角色当新语义用更安全。
    if (
      session?.token &&
      session.username &&
      typeof session.isPlatformAdmin === 'boolean' &&
      Array.isArray(session.organizations)
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
    /** 该组织在本会话中是否可治理（团队身份，逐组织判定）。 */
    isOrgManager(org: string): boolean {
      return this.organizations.some((membership) => membership.org === org && membership.isOrgManager);
    }
  }
});
