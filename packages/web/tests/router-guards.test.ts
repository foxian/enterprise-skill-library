import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { router } from '../src/router';
import { useAuthStore } from '../src/stores/auth';

// 路由守卫：未登录与角色不符的访问都应回到登录页
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

  it('普通成员访问超管路径被重定向到登录页', async () => {
    const auth = useAuthStore();
    auth.establish({ token: 'member-token', username: 'bob', org: 'acme', role: 'member' });

    await router.push('/admin/super/applications');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
  });

  it('组织管理员访问组织路径被放行', async () => {
    const auth = useAuthStore();
    auth.establish({ token: 'org-admin-token', username: 'admin', org: 'acme', role: 'org-admin' });

    await router.push('/admin/org/members');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('org-members');
  });

  it('本地会话恢复后直接可达对应角色首页', async () => {
    localStorage.setItem(
      'esl-admin-session',
      JSON.stringify({ token: 'super-token', username: 'eslroot', org: null, role: 'super' })
    );
    setActivePinia(createPinia());

    const auth = useAuthStore();
    expect(auth.role).toBe('super');
    expect(auth.homePath).toBe('/admin/super/dashboard');
  });
});
