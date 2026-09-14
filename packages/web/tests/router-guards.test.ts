import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { router } from '../src/router';
import { useAuthStore } from '../src/stores/auth';

// 路由守卫（ADR-0033 / ADR-0035）：两个正交判定——平台角色轴决定进哪个控制台，
// 逐组织治理权决定组织治理入口开不开。不再用一个全局角色值代理资源级权限。
describe('router guards', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(async () => {
    localStorage.clear();
    await router.push('/admin/login');
  });

  it('未登录访问受控路径重定向到登录页', async () => {
    await router.push('/admin/super/dashboard');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
  });

  it('普通用户访问超管路径被重定向到登录页', async () => {
    const auth = useAuthStore();
    auth.establish({
      token: 'member-token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [{ org: 'acme', identity: 'ordinary', isOwnerMember: false }]
    });

    await router.push('/admin/super/applications');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
  });

  it('超级管理员访问个人控制台被重定向到登录页——两个控制台互不越界', async () => {
    const auth = useAuthStore();
    auth.establish({ token: 'super-token', username: 'eslroot', isPlatformAdmin: true, organizations: [] });

    await router.push('/admin/me/overview');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
  });

  it('组织管理团队成员访问本组织治理路径被放行', async () => {
    const auth = useAuthStore();
    auth.establish({
      token: 'org-manager-token',
      username: 'admin',
      isPlatformAdmin: false,
      organizations: [{ org: 'acme', identity: 'owner', isOwnerMember: true }]
    });

    await router.push('/admin/me/orgs/acme/members');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('me-org-members');
  });

  it('非治理者访问组织治理路径被退回只读的组织列表', async () => {
    const auth = useAuthStore();
    auth.establish({
      token: 'member-token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [{ org: 'acme', identity: 'ordinary', isOwnerMember: false }]
    });

    await router.push('/admin/me/orgs/acme/teams');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('me-orgs');
  });

  it('在 A 组织是治理者、不在 B 组织时，B 的治理路径同样被拒', async () => {
    const auth = useAuthStore();
    auth.establish({
      token: 'org-manager-token',
      username: 'alice',
      isPlatformAdmin: false,
      organizations: [
        { org: 'acme', identity: 'owner', isOwnerMember: true },
        { org: 'beta', identity: 'ordinary', isOwnerMember: false }
      ]
    });

    await router.push('/admin/me/orgs/beta/members');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('me-orgs');

    await router.push('/admin/me/orgs/acme/members');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('me-org-members');
  });

  it('本地会话恢复后直接可达对应控制台首页', async () => {
    localStorage.setItem(
      'esl-admin-session',
      JSON.stringify({
        token: 'super-token',
        username: 'eslroot',
        isPlatformAdmin: true,
        organizations: []
      })
    );
    setActivePinia(createPinia());

    const auth = useAuthStore();
    expect(auth.isPlatformAdmin).toBe(true);
    expect(auth.homePath).toBe('/admin/super/dashboard');
  });

  it('丢弃旧形态（带 role/org）的本地会话，走重新登录', async () => {
    localStorage.setItem(
      'esl-admin-session',
      JSON.stringify({ token: 'old-token', username: 'bob', org: 'acme', role: 'member' })
    );
    setActivePinia(createPinia());

    const auth = useAuthStore();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.homePath).toBe('/admin/login');
  });
});
