import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import { router } from '../src/router';
import { setFetchImpl } from '../src/api/client';
import { initializeLocale } from '../src/i18n/locale';
import { useAuthStore, type AuthSession } from '../src/stores/auth';
import SkillDetailView from '../src/views/public/SkillDetailView.vue';
import { mountConsoleView, resetConsole, useApiMock, type RecordedRequest } from './helpers';

// 技能目录三层漏斗埋点（#199 / spec #200，本票 #206）：目录进入只计一次访问，
// 详情只在成功渲染时计数，复制命令只在剪贴板写入成功后计数；重点断言外部可见的
// 上报请求体，不锚内部实现。

const EVENT_URL = '/api/catalog/events';

interface FunnelEventBody {
  action: string;
  skillId?: string;
  bucket?: string;
  trafficSource: string;
}

function eventRequests(requests: RecordedRequest[]): FunnelEventBody[] {
  return requests
    .filter((request) => request.method === 'POST' && request.url === EVENT_URL)
    .map((request) => request.body as FunnelEventBody);
}

function catalogItem() {
  return {
    identity: '@acme/open',
    scope: 'acme',
    skillName: 'open',
    displayName: 'Acme Open',
    description: '组织内公开技能',
    latestStableVersion: '1.2.0',
    visibility: 'public',
    downloadCount: 12,
    namespaceKind: 'organization',
    namespaceName: 'acme',
    bucket: 'org',
    source: { kind: 'organization', name: 'acme' }
  };
}

const detailSkill = {
  name: '@acme/open',
  skillId: 'skill-1',
  displayName: 'Acme Open',
  description: '组织内公开技能',
  visibility: 'public',
  versions: ['1.2.0'],
  downloadCount: 12,
  keywords: ['open'],
  releases: [{ version: '1.2.0', downloadCount: 12 }]
};

const memberSession: AuthSession = {
  token: 'member-token',
  username: 'bob',
  isPlatformAdmin: false,
  organizations: [{ org: 'acme', identity: 'ordinary', isOwnerMember: false }]
};

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  await resetConsole();
});

async function mountDetail(
  route: string,
  session: AuthSession | null = memberSession
): Promise<void> {
  localStorage.clear();
  await initializeLocale({ browserLanguages: ['zh-CN'] });
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  if (session) auth.establish(session);
  else auth.logout();
  await router.push(route);
  await router.isReady();
  const container = document.createElement('div');
  document.body.appendChild(container);
  wrapper = mount(SkillDetailView, {
    attachTo: container,
    global: { plugins: [pinia, ElementPlus, router] }
  });
  await flushPromises();
}

describe('访问目录的 catalog_view', () => {
  it('进入技能目录只产生一次访问事件，切桶与搜索都不再产生', async () => {
    const { requests } = useApiMock((method, url) => {
      if (method === 'GET' && url.startsWith('/api/catalog/skills')) {
        return { status: 200, json: [catalogItem()] };
      }
      return { status: 200, json: {} };
    });

    wrapper = await mountConsoleView(App, { account: 'member', route: '/admin/me/catalog' });
    await flushPromises();

    expect(eventRequests(requests)).toEqual([
      { action: 'catalog_view', trafficSource: 'skill_catalog', bucket: 'all' }
    ]);

    await wrapper.find('[data-test="catalog-bucket"] input[value="org"]').setValue(true);
    await flushPromises();
    const input = wrapper.find('[data-test="catalog-search-input"]');
    await input.setValue('alpha');
    await input.trigger('keyup.enter');
    await flushPromises();

    // 切桶与关键词搜索各发了一次目录查询，但没有第二次访问事件。
    const events = eventRequests(requests);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('alpha');
  });

  it('上报失败不影响目录页渲染', async () => {
    useApiMock((method, url) => {
      if (url === EVENT_URL) throw new Error('telemetry endpoint unavailable');
      if (method === 'GET' && url.startsWith('/api/catalog/skills')) {
        return { status: 200, json: [catalogItem()] };
      }
      return { status: 200, json: {} };
    });

    wrapper = await mountConsoleView(App, { account: 'member', route: '/admin/me/catalog' });
    await flushPromises();

    expect(wrapper.find('[data-test="catalog-item"]').text()).toContain('@acme/open');
  });
});

describe('详情页的 detail_view', () => {
  function mockDetail(detail: unknown = detailSkill): ReturnType<typeof useApiMock> {
    return useApiMock((method, url) => {
      if (url === EVENT_URL) return { status: 202, json: {} };
      if (method === 'GET' && url.startsWith('/api/skills/')) {
        return { status: 200, json: detail };
      }
      return { status: 200, json: {} };
    });
  }

  it('成功渲染后按来向上报，技能目录来向带桶，公开目录不带桶', async () => {
    let { requests } = mockDetail();
    await mountDetail('/skills/acme/open?traffic_source=skill_catalog&bucket=org');
    expect(eventRequests(requests)).toEqual([
      { action: 'detail_view', skillId: 'skill-1', trafficSource: 'skill_catalog', bucket: 'org' }
    ]);
    expect(wrapper!.find('[data-test="detail-title"]').text()).toBe('Acme Open');
    wrapper!.unmount();
    wrapper = undefined;

    ({ requests } = mockDetail());
    await mountDetail('/skills/acme/open?traffic_source=public_catalog');
    expect(eventRequests(requests)).toEqual([
      { action: 'detail_view', skillId: 'skill-1', trafficSource: 'public_catalog' }
    ]);
    wrapper!.unmount();
    wrapper = undefined;

    ({ requests } = mockDetail());
    await mountDetail('/skills/acme/open');
    expect(eventRequests(requests)).toEqual([
      { action: 'detail_view', skillId: 'skill-1', trafficSource: 'direct_or_unknown' }
    ]);
  });

  it('统一拒绝页与未登录提示都不产生详情事件', async () => {
    let { requests } = useApiMock((method, url) => {
      if (url === EVENT_URL) return { status: 202, json: {} };
      if (method === 'GET' && url.startsWith('/api/skills/')) {
        return { status: 404, json: { code: 'skillNotFound', params: {}, message: 'Skill not found' } };
      }
      return { status: 200, json: {} };
    });
    await mountDetail('/skills/acme/secret?traffic_source=skill_catalog&bucket=org');
    expect(wrapper!.find('[data-test="detail-error"]').exists()).toBe(true);
    expect(eventRequests(requests)).toHaveLength(0);
    wrapper!.unmount();
    wrapper = undefined;

    ({ requests } = useApiMock((method, url) => {
      if (url === EVENT_URL) return { status: 202, json: {} };
      if (method === 'GET' && url.startsWith('/api/skills/')) {
        return { status: 401, json: { code: 'unauthorizedMissingToken', params: {}, message: 'Unauthorized' } };
      }
      return { status: 200, json: {} };
    }));
    await mountDetail('/skills/acme/secret', null);
    expect(wrapper!.find('[data-test="detail-login-required"]').exists()).toBe(true);
    expect(eventRequests(requests)).toHaveLength(0);
  });
});

describe('复制安装命令的 install_command_copy', () => {
  function setClipboard(writeText: () => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  }

  function mockDetail(): ReturnType<typeof useApiMock> {
    return useApiMock((method, url) => {
      if (url === EVENT_URL) return { status: 202, json: {} };
      if (method === 'GET' && url.startsWith('/api/skills/')) {
        return { status: 200, json: detailSkill };
      }
      return { status: 200, json: {} };
    });
  }

  it('剪贴板写入成功后上报，且带详情响应的技能 id', async () => {
    const { requests } = mockDetail();
    setClipboard(vi.fn(async () => undefined));
    await mountDetail('/skills/acme/open?traffic_source=skill_catalog&bucket=all');

    await wrapper!.find('[data-test="detail-copy-command"]').trigger('click');
    await flushPromises();

    expect(eventRequests(requests).filter((event) => event.action === 'install_command_copy')).toEqual([
      {
        action: 'install_command_copy',
        skillId: 'skill-1',
        trafficSource: 'skill_catalog',
        bucket: 'all'
      }
    ]);
  });

  it('剪贴板写入失败不产生复制事件', async () => {
    const { requests } = mockDetail();
    setClipboard(async () => {
      throw new Error('clipboard unavailable');
    });
    await mountDetail('/skills/acme/open?traffic_source=skill_catalog&bucket=all');

    await wrapper!.find('[data-test="detail-copy-command"]').trigger('click');
    await flushPromises();

    expect(eventRequests(requests).filter((event) => event.action === 'install_command_copy')).toHaveLength(
      0
    );
  });
});
