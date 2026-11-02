import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import ExternalReferenceCreateDialog from '../src/components/ExternalReferenceCreateDialog.vue';
import SkillsView from '../src/views/me/SkillsView.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

async function mountDialog(handler: Parameters<typeof useApiMock>[0]) {
  const requests = useApiMock(handler).requests;
  wrapper = await mountConsoleView(
    {
      components: { ExternalReferenceCreateDialog },
      template: '<ExternalReferenceCreateDialog :model-value="true" />'
    } as never,
    { account: 'solo', route: '/admin/me/skills' }
  );
  await flushPromises();
  return { wrapper: wrapper!, requests };
}

function setValue(testId: string, value: string): void {
  const host = document.querySelector(`[data-test="${testId}"]`) as HTMLElement | null;
  const input = (host?.querySelector('input, textarea') ?? host) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function clickByTest(testId: string): Promise<void> {
  (document.querySelector(`[data-test="${testId}"]`) as HTMLElement | null)?.click();
  await flushPromises();
}

describe('外部引用创建对话框', () => {
  it('填写仓库地址后预览，解析分支并展示检测到的许可证', async () => {
    const { requests } = await mountDialog((method, url) => {
      if (method === 'POST' && url === '/api/external-references/preview') {
        return {
          status: 200,
          json: {
            branch: 'main',
            commit: 'a'.repeat(40),
            files: ['SKILL.md', 'note.txt', 'LICENSE'],
            detectedLicense: 'MIT',
            licenseProvenance: { path: 'LICENSE', source: 'file' }
          }
        };
      }
      return { status: 200, json: {} };
    });

    setValue('external-repository-url', 'https://github.com/anthropics/skills.git');
    await clickByTest('external-preview-btn');

    const previewRequest = requests.find((request) => request.url.endsWith('/preview'));
    expect(previewRequest?.body).toMatchObject({
      repositoryUrl: 'https://github.com/anthropics/skills.git'
    });
    expect((document.querySelector('[data-test="external-preview-alert"]') as HTMLElement)?.textContent ?? '').toContain('MIT');
  });

  it('提交创建，携带命名空间、短名、目录、计划与可见性', async () => {
    const { requests } = await mountDialog((method, url) => {
      if (method === 'POST' && url === '/api/external-references') {
        return {
          status: 201,
          json: {
            skillName: '@carol/webapp-testing',
            initialSync: { outcome: 'license-confirmation-required' }
          }
        };
      }
      return { status: 200, json: {} };
    });

    setValue('external-short-name', 'webapp-testing');
    setValue('external-repository-url', 'https://github.com/anthropics/skills.git');
    setValue('external-skill-directory', 'webapp-testing');

    await clickByTest('external-submit');

    const createRequest = requests.find(
      (request) => request.method === 'POST' && request.url === '/api/external-references'
    );
    expect(createRequest?.body).toMatchObject({
      scope: 'carol',
      shortName: 'webapp-testing',
      skillDirectory: 'webapp-testing',
      visibility: 'private',
      schedule: expect.objectContaining({ frequency: 'daily' })
    });
  });

  it('预览被拒绝（非 HTTPS）时展示错误，不发起创建', async () => {
    const { requests } = await mountDialog((method, url) => {
      if (method === 'POST' && url.endsWith('/preview')) {
        return { status: 400, json: { code: 'externalSourceHttpsRequired', message: '仅支持公网 HTTPS 仓库' } };
      }
      return { status: 200, json: {} };
    });

    setValue('external-repository-url', 'http://example.com/repo.git');
    await clickByTest('external-preview-btn');

    expect((document.querySelector('[data-test="external-create-error"]') as HTMLElement)?.textContent ?? '').toContain('HTTPS');
    expect(requests.some((request) => request.url === '/api/external-references' && request.method === 'POST')).toBe(false);
  });
});

describe('技能列表的外部引用入口', () => {
  async function mountSkills(handler: Parameters<typeof useApiMock>[0]) {
    useApiMock(handler);
    wrapper = await mountConsoleView(SkillsView, { account: 'owner', route: '/admin/me/skills' });
    await flushPromises();
    return wrapper!;
  }

  it('显示创建外部引用按钮', async () => {
    await mountSkills(() => ({ status: 200, json: [] }));
    expect(wrapper!.find('[data-test="create-external-reference"]').exists()).toBe(true);
  });

  it('外部技能的管理按钮跳转到只读外部面板路由', async () => {
    const { router } = await import('../src/router');
    await mountSkills((method, url) => {
      if (url === '/api/skills/inventory') {
        return {
          status: 200,
          json: [
            {
              name: '@acme/webapp-testing',
              scope: 'acme',
              skillName: 'webapp-testing',
              displayName: 'webapp-testing',
              description: '',
              createdBy: 'admin',
              status: 'active-published',
              personalNamespace: false,
              access: 'manage',
              relation: 'managed',
              downloadCount: 0,
              external: true
            }
          ]
        };
      }
      if (url.includes('/permissions')) {
        return {
          status: 200,
          json: { scope: 'acme', skillName: 'webapp-testing', sharedAllRead: false, sharedAllWrite: false, sharedAllManage: false, teams: [], members: [] }
        };
      }
      return { status: 200, json: [] };
    });

    await wrapper!.find('[data-test="configure-webapp-testing"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('me-external-manage');
    expect(router.currentRoute.value.params).toMatchObject({ scope: 'acme', skillName: 'webapp-testing' });
  });
});
