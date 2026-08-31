import { defineStore } from 'pinia';

export type Role = 'super' | 'org-admin' | 'member';

export interface AuthSession {
  token: string;
  username: string;
  org: string | null;
  role: Role;
}

const STORAGE_KEY = 'esl-admin-session';

export const ROLE_HOME_PATHS: Record<Role, string> = {
  super: '/admin/super/dashboard',
  'org-admin': '/admin/org/members',
  member: '/admin/member/skills'
};

// 登录时按账号命名约定推导角色：无组织即超级管理员，
// 组织内用户名为 admin 即组织管理员，其余为普通成员。
export function deriveRole(username: string, org: string | null): Role {
  if (!org) {
    return 'super';
  }
  return username === 'admin' ? 'org-admin' : 'member';
}

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as AuthSession;
    if (session?.token && session.username && session.role) {
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
    role: (state): Role | null => state.session?.role ?? null,
    username: (state): string | null => state.session?.username ?? null,
    org: (state): string | null => state.session?.org ?? null,
    homePath(): string {
      return this.session ? ROLE_HOME_PATHS[this.session.role] : '/admin/login';
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
    }
  }
});
