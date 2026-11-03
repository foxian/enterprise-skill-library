import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import ExternalReferenceManagePanel from '../src/components/ExternalReferenceManagePanel.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

function reference(overrides: Record<string, unknown> = {}) {
  return {
    skillName: '@acme/webapp-testing',
    repositoryUrl: 'https://github.com/anthropics/skills.git',
    skillDirectory: 'webapp-testing',
    branch: 'main',
    schedule: { frequency: 'daily', time: '09:00', timeZone: 'UTC' },
    syncState: 'idle',
    visibility: 'private',
    locked: true,
    lastSyncedCommit: 'abc123de5678',
    lastSuccessfulAt: '2026-11-01T09:00:00Z',
    lastCheckedAt: '2026-11-01T09:00:00Z',
    nextCheckAt: '2026-11-02T09:00:00Z',
    currentError: null,
    errorCode: null,
    license: { basis: 'MIT', provenance: null, confirmedBy: 'alice', confirmedAt: '2026-11-01T08:00:00Z' },
    extraFiles: ['LICENSE'],
    catchupDue: false,
    ...overrides
  };
}

async function mountPanel(handler: Parameters<typeof useApiMock>[0]) {
  const requests = useApiMock(handler).requests;
  wrapper = await mountConsoleView(
    {
      components: { ExternalReferenceManagePanel },
      template: '<ExternalReferenceManagePanel scope="acme" skill-name="webapp-testing" />'
    } as never,
    { account: 'owner', route: '/admin/me/skills' }
  );
  await flushPromises();
  return { wrapper: wrapper!, requests };
}

describe('外部 Git 引用管理面板', () => {
  it('详情展示仓库、目录、分支、提交、计划时间与状态', async () => {
    await mountPanel(() => ({ status: 200, json: reference() }));

    expect(wrapper!.find('[data-test="external-view-url"]').text()).toContain('github.com');
    expect(wrapper!.find('[data-test="external-view-directory"]').text()).toBe('webapp-testing');
    expect(wrapper!.find('[data-test="external-view-branch"]').text()).toBe('main');
    expect(wrapper!.find('[data-test="external-view-commit"]').text()).toBe('abc123de');
    expect(wrapper!.find('[data-test="external-view-license"]').text()).toBe('MIT');
  });

  it('显示只读提示，且不存在编辑/上传类控件', async () => {
    await mountPanel(() => ({ status: 200, json: reference() }));

    expect(wrapper!.find('[data-test="external-readonly-alert"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="upload-source"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="edit-skill-content"]').exists()).toBe(false);
  });

  it('保存配置提交计划与可见性变更', async () => {
    const { requests } = await mountPanel(() => ({ status: 200, json: reference() }));

    wrapper!.findComponent(ExternalReferenceManagePanel).vm.draft.schedule.frequency = 'weekly';
    await flushPromises();

    await wrapper!.find('[data-test="external-save-btn"]').trigger('click');
    await flushPromises();

    const patch = requests.find((request) => request.method === 'PATCH');
    expect(patch?.body).toMatchObject({
      schedule: expect.objectContaining({ frequency: 'weekly' }),
      visibility: 'private'
    });
  });

  it('确认许可证调用 license 端点并展示成功反馈', async () => {
    const unconfirmedLicense = { basis: null, provenance: null, confirmedBy: null, confirmedAt: null };
    const { requests } = await mountPanel((method, url) => {
      if (method === 'POST' && url.includes('/license')) {
        return { status: 200, json: reference() };
      }
      return { status: 200, json: reference({ license: unconfirmedLicense }) };
    });

    wrapper!.findComponent(ExternalReferenceManagePanel).vm.licenseBasis = 'Apache-2.0';
    await flushPromises();

    await wrapper!.find('[data-test="external-license-confirm-btn"]').trigger('click');
    await flushPromises();

    const licenseRequest = requests.find((request) => request.url.includes('/license'));
    expect(licenseRequest?.body).toEqual({ basis: 'Apache-2.0' });
    expect(wrapper!.find('[data-test="external-message"]').exists()).toBe(true);
  });

  it('立即同步发布成功后展示版本号', async () => {
    await mountPanel((method, url) => {
      if (method === 'POST' && url.includes('/sync')) {
        return {
          status: 200,
          json: { outcome: 'published', skillName: '@acme/webapp-testing', version: '0.1.1', commit: 'f'.repeat(40) }
        };
      }
      return { status: 200, json: reference() };
    });

    await wrapper!.find('[data-test="external-sync-btn"]').trigger('click');
    await flushPromises();

    expect(wrapper!.find('[data-test="external-message"]').text()).toContain('0.1.1');
  });

  it('同步返回需要许可确认时展示错误提示', async () => {
    await mountPanel((method, url) => {
      if (method === 'POST' && url.includes('/sync')) {
        return {
          status: 200,
          json: { outcome: 'license-confirmation-required', skillName: '@acme/webapp-testing' }
        };
      }
      return { status: 200, json: reference() };
    });

    await wrapper!.find('[data-test="external-sync-btn"]').trigger('click');
    await flushPromises();

    expect(wrapper!.find('[data-test="external-message"]').text()).toContain('许可证');
  });

  it('失败状态展示错误信息与失败标签', async () => {
    await mountPanel(() => ({
      status: 200,
      json: reference({ syncState: 'failed', currentError: 'Upstream not reachable', errorCode: 'externalSourceFetchFailed' })
    }));

    expect(wrapper!.find('[data-test="external-view-error"]').text()).toContain('not reachable');
    expect(wrapper!.find('[data-test="external-state-tag"]').text()).toContain('失败');
  });

  it('暂停后显示恢复按钮，恢复调用 resume 端点', async () => {
    const { requests } = await mountPanel((method, url) => {
      if (method === 'POST' && url.includes('/resume')) {
        return { status: 200, json: reference({ syncState: 'idle' }) };
      }
      return { status: 200, json: reference({ syncState: 'paused' }) };
    });

    expect(wrapper!.find('[data-test="external-resume-btn"]').exists()).toBe(true);
    await wrapper!.find('[data-test="external-resume-btn"]').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.url.includes('/resume'))).toBe(true);
  });

  it('无权读取私有引用时展示权限错误，不渲染来源详情', async () => {
    await mountPanel(() => ({
      status: 403,
      json: { code: 'forbiddenManagePermissionRequired', message: 'Forbidden' }
    }));

    expect(wrapper!.find('[data-test="external-message"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="external-view-url"]').text()).toBe('');
  });

  it('移除引用说明区分停止同步与删除技能，并跳转既有生命周期面板', async () => {
    const { router } = await import('../src/router');
    await mountPanel(() => ({ status: 200, json: reference() }));

    const hint = wrapper!.find('[data-test="external-remove-hint"]').text();
    expect(hint).toContain('归档');
    expect(hint).toContain('删除');

    await wrapper!.find('[data-test="external-open-lifecycle"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('me-skill-manage');
    expect(router.currentRoute.value.params).toMatchObject({ scope: 'acme', skillName: 'webapp-testing' });
  });
});
