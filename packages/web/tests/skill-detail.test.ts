import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import App from '../src/App.vue';
import { router } from '../src/router';
import { setFetchImpl } from '../src/api/client';
import { initializeLocale } from '../src/i18n/locale';
import { useAuthStore, type AuthSession } from '../src/stores/auth';
import SkillDetailView from '../src/views/public/SkillDetailView.vue';
import { resetConsole } from './helpers';

// 共用详情页闭环（spec #200 / T5）：按来向渲染单一返回出口，消费侧三种不可用
// 状态收敛为统一拒绝，复制安装命令成功与否可观察。断言只落在用户可见行为上。

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
}

function useApiMock(handler: (url: string) => { status: number; json: unknown }): {
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  setFetchImpl(
    (async (url: string | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? 'GET',
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

const memberSession: AuthSession = {
  token: 'member-token',
  username: 'bob',
  isPlatformAdmin: false,
  organizations: [{ org: 'acme', identity: 'ordinary', isOwnerMember: false }]
};

const detailSkill = {
  name: '@acme/open',
  displayName: 'Acme Open',
  description: '组织内公开技能',
  visibility: 'public',
  versions: ['1.2.0'],
  downloadCount: 12,
  keywords: ['open'],
  releases: [{ version: '1.2.0', downloadCount: 12 }]
};

function detailOk(): { status: number; json: unknown } {
  return { status: 200, json: detailSkill };
}

function skillNotFound(): { status: number; json: unknown } {
  return { status: 404, json: { code: 'skillNotFound', params: {}, message: 'Skill not found' } };
}

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  await resetConsole();
});

async function mountView(
  component: Component,
  route: string,
  session: AuthSession | null = null
): Promise<VueWrapper> {
  localStorage.clear();
  await initializeLocale({ browserLanguages: ['zh-CN'] });
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  if (session) {
    auth.establish(session);
  } else {
    auth.logout();
  }
  await router.push(route);
  await router.isReady();
  const container = document.createElement('div');
  document.body.appendChild(container);
  return mount(component, {
    attachTo: container,
    global: { plugins: [pinia, ElementPlus, router] }
  });
}

function backLink() {
  return wrapper!.find('[data-test="detail-back"]');
}

function backHref(): URL {
  return new URL(backLink().attributes('href')!, 'http://localhost');
}

describe('共用详情页返回出口', () => {
  it('从技能目录进入时只有一个「返回技能目录」出口，并带回原桶与关键词', async () => {
    useApiMock(detailOk);
    wrapper = await mountView(
      SkillDetailView,
      '/skills/acme/open?traffic_source=skill_catalog&bucket=granted&q=alpha',
      memberSession
    );
    await flushPromises();

    expect(wrapper.findAll('[data-test="detail-back"]')).toHaveLength(1);
    expect(backLink().text()).toBe('返回技能目录');
    const url = backHref();
    expect(url.pathname).toBe('/admin/me/catalog');
    expect(url.searchParams.get('bucket')).toBe('granted');
    expect(url.searchParams.get('q')).toBe('alpha');
  });

  it('从技能目录进入但未带桶与关键词时回到全量视图', async () => {
    useApiMock(detailOk);
    wrapper = await mountView(
      SkillDetailView,
      '/skills/acme/open?traffic_source=skill_catalog',
      memberSession
    );
    await flushPromises();

    expect(backLink().text()).toBe('返回技能目录');
    const url = backHref();
    expect(url.pathname).toBe('/admin/me/catalog');
    expect(url.searchParams.get('bucket')).toBe('all');
    expect(url.searchParams.get('q')).toBeNull();
  });

  it('从公开目录进入时即使已登录也返回公开目录', async () => {
    useApiMock(detailOk);
    wrapper = await mountView(
      SkillDetailView,
      '/skills/acme/open?traffic_source=public_catalog',
      memberSession
    );
    await flushPromises();

    expect(backLink().text()).toBe('返回技能列表');
    expect(backHref().pathname).toBe('/skills');
  });

  it('无来源标记直拼时登录主体回技能目录全量视图', async () => {
    useApiMock(detailOk);
    wrapper = await mountView(SkillDetailView, '/skills/acme/open', memberSession);
    await flushPromises();

    expect(backLink().text()).toBe('返回技能目录');
    const url = backHref();
    expect(url.pathname).toBe('/admin/me/catalog');
    expect(url.searchParams.get('bucket')).toBe('all');
  });

  it('匿名直拼回公开目录，且任何匿名场景都不出现「返回技能目录」', async () => {
    useApiMock(detailOk);

    wrapper = await mountView(SkillDetailView, '/skills/acme/open');
    await flushPromises();
    expect(backLink().text()).toBe('返回技能列表');
    expect(backHref().pathname).toBe('/skills');
    wrapper.unmount();

    wrapper = await mountView(
      SkillDetailView,
      '/skills/acme/open?traffic_source=skill_catalog&bucket=org',
      null
    );
    await flushPromises();
    expect(backLink().text()).toBe('返回技能列表');
    expect(backHref().pathname).toBe('/skills');
    expect(wrapper.text()).not.toContain('返回技能目录');
  });

  it('平台管理员直拼详情回公开目录，不指向无法进入的个人控制台', async () => {
    useApiMock(detailOk);
    wrapper = await mountView(SkillDetailView, '/skills/acme/open', {
      token: 'super-token',
      username: 'eslroot',
      isPlatformAdmin: true,
      organizations: []
    });
    await flushPromises();

    expect(backLink().text()).toBe('返回技能列表');
    expect(backHref().pathname).toBe('/skills');
  });
});

describe('共用详情页统一拒绝', () => {
  it('已登录遇到 404 展示统一「无权访问或已下架」，不渲染任何技能元数据', async () => {
    useApiMock(skillNotFound);
    wrapper = await mountView(
      SkillDetailView,
      '/skills/acme/secret?traffic_source=skill_catalog&bucket=org',
      memberSession
    );
    await flushPromises();

    const alert = wrapper.find('[data-test="detail-error"]');
    expect(alert.text()).toContain('无权访问或已下架');
    expect(wrapper.find('[data-test="detail-title"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="detail-identity"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="detail-install-card"]').exists()).toBe(false);
    // 拒绝页仍有单一返回出口
    expect(backLink().text()).toBe('返回技能目录');
    expect(backHref().pathname).toBe('/admin/me/catalog');
  });

  it('匿名遇到 404 保留既有「未找到该技能」文案与公开目录出口', async () => {
    useApiMock(skillNotFound);
    wrapper = await mountView(SkillDetailView, '/skills/acme/secret');
    await flushPromises();

    expect(wrapper.find('[data-test="detail-error"]').text()).toContain('未找到该技能');
    expect(backLink().text()).toBe('返回技能列表');
  });

  it('匿名遇到 401 保留登录提示', async () => {
    useApiMock(() => ({
      status: 401,
      json: { code: 'unauthorizedMissingToken', params: {}, message: 'Unauthorized' }
    }));
    wrapper = await mountView(SkillDetailView, '/skills/acme/closed');
    await flushPromises();

    expect(wrapper.find('[data-test="detail-login-required"]').exists()).toBe(true);
  });

  it('展示服务端下发的最新稳定版，带 build metadata 也不漏', async () => {
    useApiMock(() => ({
      status: 200,
      json: {
        ...detailSkill,
        versions: ['1.1.0-beta.1', '1.0.0+build.5'],
        latestStableVersion: '1.0.0+build.5'
      }
    }));
    wrapper = await mountView(SkillDetailView, '/skills/acme/open', memberSession);
    await flushPromises();

    // 旧实现用 /^\d+\.\d+\.\d+$/ 自判，1.0.0+build.5 会被漏掉；以服务端字段为准。
    expect(wrapper.find('[data-test="detail-latest-stable"]').text()).toContain('1.0.0+build.5');
  });

  it('授权 private 正常打开并展示安装命令', async () => {
    useApiMock(() => ({
      status: 200,
      json: { ...detailSkill, visibility: 'private', versions: ['2.0.0'] }
    }));
    wrapper = await mountView(
      SkillDetailView,
      '/skills/acme/secret?traffic_source=skill_catalog&bucket=granted',
      memberSession
    );
    await flushPromises();

    expect(wrapper.find('[data-test="detail-title"]').text()).toBe('Acme Open');
    expect(wrapper.find('[data-test="detail-install-command"]').text()).toBe(
      'esl skill install @acme/secret'
    );
  });
});

describe('复制安装命令', () => {
  function setClipboard(writeText: () => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
  }

  it('剪贴板写入成功才提示已复制', async () => {
    useApiMock(detailOk);
    const writeText = vi.fn(async () => undefined);
    setClipboard(writeText);
    wrapper = await mountView(SkillDetailView, '/skills/acme/open', memberSession);
    await flushPromises();

    await wrapper.find('[data-test="detail-copy-command"]').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('esl skill install @acme/open');
    expect(document.body.textContent).toContain('已复制');
  });

  it('剪贴板写入失败不显示成功提示', async () => {
    useApiMock(detailOk);
    setClipboard(async () => {
      throw new Error('clipboard unavailable');
    });
    wrapper = await mountView(SkillDetailView, '/skills/acme/open', memberSession);
    await flushPromises();

    await wrapper.find('[data-test="detail-copy-command"]').trigger('click');
    await flushPromises();

    expect(document.body.textContent).not.toContain('已复制');
    // 命令本身仍展示，失败不阻断浏览
    expect(wrapper.find('[data-test="detail-install-command"]').text()).toBe(
      'esl skill install @acme/open'
    );
  });
});

describe('返回技能目录后重新加载', () => {
  it('点击返回出口回到技能目录并重新请求列表', async () => {
    const { requests } = useApiMock((url) => {
      if (url.startsWith('/api/catalog/skills')) return { status: 200, json: [] };
      return detailOk();
    });
    wrapper = await mountView(
      App,
      '/skills/acme/open?traffic_source=skill_catalog&bucket=org&q=alpha',
      memberSession
    );
    await flushPromises();

    await wrapper.find('[data-test="detail-back"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/admin/me/catalog');
    expect(router.currentRoute.value.query.bucket).toBe('org');
    expect(router.currentRoute.value.query.q).toBe('alpha');
    const catalogRequests = requests.filter((request) => request.url.startsWith('/api/catalog/skills'));
    expect(catalogRequests).toHaveLength(1);
    expect(catalogRequests[0].url).toContain('bucket=org');
    expect(catalogRequests[0].url).toContain('q=alpha');
  });
});
