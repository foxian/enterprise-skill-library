import { ElPagination } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import DownloadLogsView from '../src/views/super/DownloadLogsView.vue';
import { mountConsoleView, resetConsole, useApiMock, type RecordedRequest } from './helpers';

// 下载日志明细（ADR-0067）：服务端筛选 + 服务端分页。这里的断言盯住两件事——
// 请求参数确实按筛选/页码构造，且响应里的 total 与行内容如实呈现。
const logs = [
  {
    id: 1,
    skillId: 'sk_1',
    skillIdentity: '@acme/reviewer',
    version: '1.2.0',
    requestedSpecifier: '@acme/reviewer@1.2.0',
    userId: 'u_1',
    username: 'acme_bob',
    clientIpTruncated: '203.0.113.0/24',
    osPlatform: 'linux',
    osArch: 'x64',
    eslVersion: '0.4.0',
    nodeVersion: '20.11.0',
    downloadedAt: '2026-09-01T10:00:00.000Z',
    result: 'success',
    failureReason: null
  },
  {
    id: 2,
    skillId: null,
    skillIdentity: null,
    version: null,
    requestedSpecifier: '@acme/secret',
    userId: null,
    username: null,
    clientIpTruncated: null,
    osPlatform: null,
    osArch: null,
    eslVersion: null,
    nodeVersion: null,
    downloadedAt: '2026-09-02T10:00:00.000Z',
    result: 'failure',
    failureReason: 'skill not found'
  }
];

let wrapper: VueWrapper | undefined;

function pageResponse(items = logs, overrides: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, pageSize: 50, ...overrides };
}

function logRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.url.startsWith('/api/admin/download-logs'));
}

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

describe('DownloadLogsView 超管下载日志查询', () => {
  it('挂载即以默认分页发起服务端查询并渲染明细行', async () => {
    const { requests } = useApiMock((_method, url) => {
      if (url.startsWith('/api/admin/download-logs')) return { status: 200, json: pageResponse() };
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(DownloadLogsView, { account: 'platformAdmin', route: '/admin/super/download-logs' });
    await flushPromises();

    expect(logRequests(requests)).toContainEqual({
      method: 'GET',
      url: '/api/admin/download-logs?page=1&pageSize=50',
      body: undefined
    });

    const table = wrapper.find('[data-test="download-logs-table"]').text();
    expect(table).toContain('@acme/reviewer');
    expect(table).toContain('acme_bob');
    expect(table).toContain('203.0.113.0/24');
    expect(table).toContain('linux/x64');
    expect(table).toContain('skill not found');
    expect(wrapper.find('[data-test="download-log-result-1"]').text()).toBe('成功');
    expect(wrapper.find('[data-test="download-log-result-2"]').text()).toBe('失败');
    // total 来自响应，不是本地行数
    expect(wrapper.findComponent(ElPagination).props('total')).toBe(2);
  });

  it('修改筛选条件后带全部筛选参数重新查询，且回到第 1 页', async () => {
    const { requests } = useApiMock((_method, url) => {
      if (url.startsWith('/api/admin/download-logs')) return { status: 200, json: pageResponse() };
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(DownloadLogsView, { account: 'platformAdmin', route: '/admin/super/download-logs' });
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      skill: string;
      username: string;
      result: string;
      range: [string, string] | null;
      page: number;
    };
    vm.skill = '@acme/reviewer';
    vm.username = 'acme_bob';
    vm.result = 'failure';
    vm.range = ['2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'];
    await wrapper.find('[data-test="download-log-search-submit"]').trigger('click');
    await flushPromises();

    const expected = new URLSearchParams({
      skill: '@acme/reviewer',
      username: 'acme_bob',
      result: 'failure',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      page: '1',
      pageSize: '50'
    }).toString();
    expect(logRequests(requests).at(-1)?.url).toBe(`/api/admin/download-logs?${expected}`);
  });

  it('翻页与改页大小都重新发起服务端查询，改页大小回到第 1 页', async () => {
    const { requests } = useApiMock((_method, url) => {
      if (url.startsWith('/api/admin/download-logs')) {
        return { status: 200, json: pageResponse(logs, { total: 120 }) };
      }
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(DownloadLogsView, { account: 'platformAdmin', route: '/admin/super/download-logs' });
    await flushPromises();

    const pager = wrapper.findComponent(ElPagination);
    pager.vm.$emit('update:current-page', 3);
    await flushPromises();
    expect(logRequests(requests).at(-1)?.url).toBe('/api/admin/download-logs?page=3&pageSize=50');

    pager.vm.$emit('update:page-size', 100);
    await flushPromises();
    expect(logRequests(requests).at(-1)?.url).toBe('/api/admin/download-logs?page=1&pageSize=100');
  });

  it('查询失败时展示服务端错误，不渲染行', async () => {
    useApiMock((_method, url) => {
      if (url.startsWith('/api/admin/download-logs')) {
        return { status: 403, json: { error: 'forbidden' } };
      }
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(DownloadLogsView, { account: 'platformAdmin', route: '/admin/super/download-logs' });
    await flushPromises();

    expect(wrapper.find('.page-error').text()).toContain('forbidden');
    expect(wrapper.find('[data-test="download-log-result-1"]').exists()).toBe(false);
  });

  it('重新查询失败时清空上一页结果，不把旧行留在错误提示下方', async () => {
    let failNext = false;
    useApiMock((_method, url) => {
      if (url.startsWith('/api/admin/download-logs')) {
        return failNext ? { status: 403, json: { error: 'forbidden' } } : { status: 200, json: pageResponse(logs, { total: 2 }) };
      }
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(DownloadLogsView, { account: 'platformAdmin', route: '/admin/super/download-logs' });
    await flushPromises();
    expect(wrapper.find('[data-test="download-log-result-1"]').exists()).toBe(true);

    failNext = true;
    wrapper.findComponent(ElPagination).vm.$emit('update:current-page', 2);
    await flushPromises();

    expect(wrapper.find('.page-error').text()).toContain('forbidden');
    expect(wrapper.find('[data-test="download-log-result-1"]').exists()).toBe(false);
  });

  it('无匹配记录时展示空态文案', async () => {
    useApiMock((_method, url) => {
      if (url.startsWith('/api/admin/download-logs')) {
        return { status: 200, json: pageResponse([], { total: 0 }) };
      }
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(DownloadLogsView, { account: 'platformAdmin', route: '/admin/super/download-logs' });
    await flushPromises();

    expect(wrapper.find('[data-test="download-logs-table"]').text()).toContain('没有符合条件的下载记录');
  });
});
