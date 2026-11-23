import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import App from '../src/App.vue';
import { router } from '../src/router';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

// 个人控制台「技能目录」：消费 T3 的 GET /api/catalog/skills，验证用户可见行为
// （菜单、桶、搜索、空态、卡片与详情链接），不断言内部实现。

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.restoreAllMocks();
  await resetConsole();
});

interface CatalogItem {
  identity: string;
  scope: string;
  skillName: string;
  displayName: string;
  description: string;
  latestStableVersion?: string;
  visibility: string;
  downloadCount: number;
  namespaceKind: 'organization' | 'personal';
  namespaceName: string;
  bucket: 'platform' | 'org' | 'granted';
  source: { kind: 'organization' | 'person' | 'self'; name: string };
}

function mockCatalog(items: CatalogItem[] = []): ReturnType<typeof useApiMock> {
  return useApiMock((method, url) => {
    if (method === 'GET' && url.startsWith('/api/catalog/skills')) {
      return { status: 200, json: items };
    }
    return { status: 200, json: [] };
  });
}

const orgItem: CatalogItem = {
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

const anonymousItem: CatalogItem = {
  identity: '@platform/anon',
  scope: 'platform',
  skillName: 'anon',
  displayName: 'Anon Tool',
  description: '匿名可见技能',
  latestStableVersion: '0.9.0',
  visibility: 'anonymous',
  downloadCount: 3,
  namespaceKind: 'personal',
  namespaceName: 'platform',
  bucket: 'platform',
  source: { kind: 'person', name: 'platform' }
};

const orgPrivateItem: CatalogItem = {
  identity: '@acme/confidential',
  scope: 'acme',
  skillName: 'confidential',
  displayName: 'Acme Confidential',
  description: '组织内私有技能',
  latestStableVersion: '3.1.0',
  visibility: 'private',
  downloadCount: 21,
  namespaceKind: 'organization',
  namespaceName: 'acme',
  bucket: 'org',
  source: { kind: 'organization', name: 'acme' }
};

const personPrivateItem: CatalogItem = {
  identity: '@dave/secret',
  scope: 'dave',
  skillName: 'secret',
  displayName: 'Dave Secret',
  description: '他人授权的私有技能',
  latestStableVersion: '2.0.0',
  visibility: 'private',
  downloadCount: 5,
  namespaceKind: 'personal',
  namespaceName: 'dave',
  bucket: 'granted',
  source: { kind: 'person', name: 'dave' }
};

const selfPrivateItem: CatalogItem = {
  identity: '@carol/mine',
  scope: 'carol',
  skillName: 'mine',
  displayName: 'My Tool',
  description: '本人私有技能',
  latestStableVersion: '1.0.0',
  visibility: 'private',
  downloadCount: 8,
  namespaceKind: 'personal',
  namespaceName: 'carol',
  bucket: 'granted',
  source: { kind: 'self', name: 'carol' }
};

const grantedItem: CatalogItem = personPrivateItem;

function catalogRequests(requests: Array<{ method: string; url: string }>): URL[] {
  return requests
    .filter((request) => request.method === 'GET' && request.url.startsWith('/api/catalog/skills'))
    .map((request) => new URL(request.url, 'http://localhost'));
}

async function mountCatalog(account: 'member' | 'solo', route = '/admin/me/catalog'): Promise<void> {
  wrapper = await mountConsoleView(App, { account, route });
  await flushPromises();
}

describe('个人控制台技能目录', () => {
  it('侧边栏第六项为技能目录，进入后默认加载全部桶', async () => {
    const { requests } = mockCatalog();
    await mountCatalog('member');

    const labels = wrapper!.findAll('.el-menu-item').map((item) => item.text());
    expect(labels).toEqual(['概览', '个人信息', '我的组织', '技能', '技能目录', '邀请']);
    const active = wrapper!.findAll('.el-menu-item').find((item) => item.text() === '技能目录');
    expect(active?.classes()).toContain('is-active');

    const urls = catalogRequests(requests);
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get('bucket')).toBe('all');
    expect(router.currentRoute.value.name).toBe('me-catalog');
  });

  it('既有管理向「技能」页仍可进入且页面不变', async () => {
    mockCatalog();
    wrapper = await mountConsoleView(App, { account: 'member', route: '/admin/me/skills' });
    await flushPromises();

    const labels = wrapper.findAll('.el-menu-item').map((item) => item.text());
    expect(labels).toEqual(['概览', '个人信息', '我的组织', '技能', '技能目录', '邀请']);
    expect(wrapper.find('[data-test="skill-list-managed"]').exists()).toBe(true);
    expect(
      wrapper.findAll('.el-menu-item').find((item) => item.text() === '技能')?.classes()
    ).toContain('is-active');
  });

  it('四个互斥桶不带数量徽标，切换后请求带当前桶并写回 URL', async () => {
    const { requests } = mockCatalog();
    await mountCatalog('member');

    const options = wrapper!.findAll('[data-test="catalog-bucket"] .el-radio-button');
    expect(options.map((option) => option.text())).toEqual(['全部', '平台公开', '我的组织', '授权给我']);

    await wrapper!.find('[data-test="catalog-bucket"] input[value="org"]').setValue(true);
    await flushPromises();

    const radios = wrapper!.findAll('[data-test="catalog-bucket"] input[type="radio"]');
    expect(radios.filter((radio) => (radio.element as HTMLInputElement).checked)).toHaveLength(1);
    expect(catalogRequests(requests).at(-1)!.searchParams.get('bucket')).toBe('org');
    expect(router.currentRoute.value.query.bucket).toBe('org');
  });

  it('关键词与当前桶 AND 叠加，回车与按钮都能触发搜索', async () => {
    const { requests } = mockCatalog();
    await mountCatalog('member');
    await wrapper!.find('[data-test="catalog-bucket"] input[value="granted"]').setValue(true);
    await flushPromises();

    const input = wrapper!.find('[data-test="catalog-search-input"]');
    await input.setValue('alpha');
    await input.trigger('keyup.enter');
    await flushPromises();

    let last = catalogRequests(requests).at(-1)!;
    expect(last.searchParams.get('bucket')).toBe('granted');
    expect(last.searchParams.get('q')).toBe('alpha');
    expect(router.currentRoute.value.query.q).toBe('alpha');

    await input.setValue('beta');
    await wrapper!.find('[data-test="catalog-search-submit"]').trigger('click');
    await flushPromises();

    last = catalogRequests(requests).at(-1)!;
    expect(last.searchParams.get('bucket')).toBe('granted');
    expect(last.searchParams.get('q')).toBe('beta');
    expect(router.currentRoute.value.query.q).toBe('beta');
  });

  it('切桶只发一次请求，保留已提交关键词且不清空未提交输入', async () => {
    const { requests } = mockCatalog([]);
    await mountCatalog('member', '/admin/me/catalog?bucket=all&q=alpha');

    const input = wrapper!.find('[data-test="catalog-search-input"]');
    // 输入但未提交：切桶不应把它当成新的搜索条件，也不应清空输入框。
    await input.setValue('draft');
    await wrapper!.find('[data-test="catalog-bucket"] input[value="org"]').setValue(true);
    await flushPromises();

    const urls = catalogRequests(requests);
    // 初次进入 + 切桶，各一次；route 是唯一数据源，不能再由两个 watcher 各触发一次。
    expect(urls).toHaveLength(2);
    expect(urls[0].searchParams.get('bucket')).toBe('all');
    expect(urls[0].searchParams.get('q')).toBe('alpha');
    expect(urls[1].searchParams.get('bucket')).toBe('org');
    expect(urls[1].searchParams.get('q')).toBe('alpha');
    expect((input.element as HTMLInputElement).value).toBe('draft');
    expect(router.currentRoute.value.query.q).toBe('alpha');
  });

  it('直接打开带 bucket 与 q 的链接时恢复筛选并加载', async () => {
    const { requests } = mockCatalog([grantedItem]);
    await mountCatalog('member', '/admin/me/catalog?bucket=granted&q=alpha');

    const urls = catalogRequests(requests);
    expect(urls[0].searchParams.get('bucket')).toBe('granted');
    expect(urls[0].searchParams.get('q')).toBe('alpha');
    expect((wrapper!.find('[data-test="catalog-search-input"]').element as HTMLInputElement).value).toBe('alpha');

    const checked = wrapper!
      .findAll('[data-test="catalog-bucket"] input[type="radio"]')
      .filter((radio) => (radio.element as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect((checked[0].element as HTMLInputElement).value).toBe('granted');
    expect(wrapper!.find('[data-test="catalog-list"]').text()).toContain('@dave/secret');
  });

  it('卡片展示识别字段与来源，anonymous 对登录主体显示为公开，不出现团队与档位', async () => {
    mockCatalog([orgItem, orgPrivateItem, personPrivateItem, selfPrivateItem, anonymousItem]);
    await mountCatalog('member');

    const cards = wrapper!.findAll('[data-test="catalog-item"]');
    expect(cards).toHaveLength(5);

    const orgCard = cards.find((card) => card.text().includes('@acme/open'))!;
    expect(orgCard.text()).toContain('Acme Open');
    expect(orgCard.text()).toContain('组织');
    expect(orgCard.text()).toContain('acme');
    expect(orgCard.text()).toContain('组织内公开技能');
    expect(orgCard.text()).toContain('1.2.0');
    expect(orgCard.text()).toContain('下载量：12');
    expect(orgCard.text()).toContain('公开');
    // 公开卡片没有 private 来源行
    expect(orgCard.find('[data-test="catalog-item-source"]').exists()).toBe(false);

    const orgPrivateCard = cards.find((card) => card.text().includes('@acme/confidential'))!;
    expect(orgPrivateCard.text()).toContain('私有');
    expect(orgPrivateCard.find('[data-test="catalog-item-source"]').text()).toBe('来源组织：acme');

    const personCard = cards.find((card) => card.text().includes('@dave/secret'))!;
    expect(personCard.text()).toContain('私有');
    expect(personCard.text()).toContain('个人');
    expect(personCard.find('[data-test="catalog-item-source"]').text()).toBe('授权方：dave');

    const selfCard = cards.find((card) => card.text().includes('@carol/mine'))!;
    expect(selfCard.find('[data-test="catalog-item-source"]').text()).toBe('我的技能');

    const anonymousCard = cards.find((card) => card.text().includes('@platform/anon'))!;
    expect(anonymousCard.text()).toContain('公开');
    expect(anonymousCard.text()).toContain('个人');
    expect(anonymousCard.text()).not.toContain('任何人可安装');

    const listText = wrapper!.find('[data-test="catalog-list"]').text();
    expect(listText).not.toContain('团队');
  });

  it('搜索无结果时给出搜索空态', async () => {
    mockCatalog([]);
    await mountCatalog('member');
    await wrapper!.find('[data-test="catalog-search-input"]').setValue('zzz');
    await wrapper!.find('[data-test="catalog-search-submit"]').trigger('click');
    await flushPromises();

    expect(wrapper!.find('[data-test="catalog-empty"]').text()).toContain('没有找到匹配关键词的技能');
  });

  it('无组织用户的「我的组织」桶给出专门空态', async () => {
    mockCatalog([]);
    await mountCatalog('solo');
    await wrapper!.find('[data-test="catalog-bucket"] input[value="org"]').setValue(true);
    await flushPromises();

    const empty = wrapper!.find('[data-test="catalog-empty"]');
    expect(empty.text()).toContain('你还没有加入任何组织');
  });

  it('有组织时桶为空与整体无内容分别给出对称空态', async () => {
    mockCatalog([]);
    await mountCatalog('member');
    expect(wrapper!.find('[data-test="catalog-empty"]').text()).toContain('暂无可安装的技能');

    await wrapper!.find('[data-test="catalog-bucket"] input[value="platform"]').setValue(true);
    await flushPromises();
    expect(wrapper!.find('[data-test="catalog-empty"]').text()).toContain('该范围暂时没有可安装的技能');
  });

  it('卡片链接指向共用详情页并携带来源标记、当前桶与关键词', async () => {
    mockCatalog([orgItem]);
    await mountCatalog('member', '/admin/me/catalog?bucket=org&q=acme');

    const link = wrapper!.find('[data-test="catalog-item-link"]');
    expect(link.text()).toBe('Acme Open');
    const url = new URL(link.attributes('href')!, 'http://localhost');
    expect(url.pathname).toBe('/skills/acme/open');
    expect(url.searchParams.get('traffic_source')).toBe('skill_catalog');
    expect(url.searchParams.get('bucket')).toBe('org');
    expect(url.searchParams.get('q')).toBe('acme');
  });

  it('从详情返回目录时尽力恢复离开前的滚动位置', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    mockCatalog([orgItem]);
    await mountCatalog('member');

    Object.defineProperty(window, 'scrollY', { value: 480, configurable: true });
    await wrapper!.find('[data-test="catalog-item-link"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('public-skill-detail');

    wrapper!.unmount();
    await mountCatalog('member');
    expect(scrollTo).toHaveBeenCalledWith({ top: 480 });
  });
});
