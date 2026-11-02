import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'vue';
import { router } from '../src/router';
import { setFetchImpl } from '../src/api/client';
import { initializeLocale } from '../src/i18n/locale';
import { useAuthStore } from '../src/stores/auth';
import CatalogView from '../src/views/public/CatalogView.vue';
import SkillDetailView from '../src/views/public/SkillDetailView.vue';
import { resetConsole } from './helpers';

// 公开目录需要同时断言「请求不带 Authorization」，因此本文件自带记录 headers
// 的 fetch mock，不扩展共享 helper 的请求形状。
interface PublicRequest {
  url: string;
  headers: Record<string, string>;
}

function useApiMock(handler: (url: string) => { status: number; json: unknown }): {
  requests: PublicRequest[];
} {
  const requests: PublicRequest[] = [];
  setFetchImpl(
    (async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
            key.toLowerCase(),
            value
          ])
        )
      });
      const { status, json } = handler(String(url));
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch
  );
  return { requests };
}

// 公开消费者目录（ADR-0073）：匿名访客不需要登录态即可浏览 anonymous 技能，
// 请求不携带 Authorization；管理后台路由仍由既有守卫保护。
let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  await resetConsole();
});

async function mountPublic(component: Component, route: string): Promise<VueWrapper> {
  localStorage.clear();
  await initializeLocale({ browserLanguages: ['zh-CN'] });
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().logout();
  await router.push(route);
  await router.isReady();
  return mount(component, {
    global: { plugins: [pinia, ElementPlus, router] }
  });
}

describe('公开技能目录', () => {
  it('匿名浏览时请求不带凭据，并渲染 anonymous 技能', async () => {
    const { requests } = useApiMock(() => ({
      status: 200,
      json: [
        {
          name: '@alice/open',
          scope: 'alice',
          skillName: 'open',
          displayName: 'Open',
          description: 'Anonymous skill',
          latestStableVersion: '1.0.0',
          visibility: 'anonymous',
          downloadCount: 7
        }
      ]
    }));

    wrapper = await mountPublic(CatalogView, '/skills');
    await flushPromises();

    const list = wrapper.find('[data-test="catalog-list"]').text();
    expect(list).toContain('Open');
    expect(list).toContain('@alice/open');
    expect(list).toContain('任何人可安装');
    expect(requests[0].url).toBe('/api/skills/search');
    expect(requests[0].headers.authorization).toBeUndefined();
  });

  it('匿名详情展示安全字段与安装命令', async () => {
    useApiMock((url) => {
      if (url.startsWith('/api/skills/')) {
        return {
          status: 200,
          json: {
            name: '@alice/open',
            displayName: 'Open',
            description: 'Anonymous skill',
            visibility: 'anonymous',
            versions: ['1.0.0'],
            downloadCount: 7,
            keywords: ['open'],
            releases: [
              {
                version: '1.0.0',
                packageUrl: '/api/packages/sk_x/1.0.0/sha256-abc.zip',
                downloadCount: 7
              }
            ]
          }
        };
      }
      return { status: 404, json: { code: 'skillNotFound', message: 'Skill not found' } };
    });

    wrapper = await mountPublic(SkillDetailView, '/skills/alice/open');
    await flushPromises();

    expect(wrapper.find('[data-test="detail-title"]').text()).toBe('Open');
    expect(wrapper.find('[data-test="detail-visibility"]').text()).toBe('任何人可安装');
    expect(wrapper.find('[data-test="detail-install-command"]').text()).toBe('esl skill install @alice/open');
    expect(wrapper.find('[data-test="detail-releases-card"]').text()).toContain('1.0.0');
  });

  it('访问非匿名技能时提示登录，而不是伪装成不存在', async () => {
    useApiMock(() => ({
      status: 401,
      json: { code: 'unauthorizedMissingToken', message: 'Unauthorized: missing token' }
    }));

    wrapper = await mountPublic(SkillDetailView, '/skills/alice/closed');
    await flushPromises();

    expect(wrapper.find('[data-test="detail-login-required"]').exists()).toBe(true);
  });
});
