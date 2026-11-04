import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import SkillManagePanel from '../src/components/SkillManagePanel.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

function permissions(status: string, lifecycle = { canArchive: true, canRestore: false, canDelete: false }) {
  return {
    scope: 'acme',
    skillName: 'reviewer',
    sharedAllRead: false,
    sharedAllWrite: false,
    sharedAllManage: false,
    teams: [],
    members: [],
    viewerAccess: 'manage',
    viewerLifecycle: lifecycle,
    skill: {
      name: '@acme/reviewer',
      description: 'Reviewer',
      status,
      everPublished: true,
      deletionError: status === 'delete_failed' ? 'Gitea unavailable' : null,
      createdBy: 'acme_alice',
      releases: []
    }
  };
}

async function mountPanel(route = '/admin/me/skills', account: 'member' | 'owner' = 'member') {
  wrapper = await mountConsoleView(
    { components: { SkillManagePanel }, template: '<SkillManagePanel scope="acme" skill-name="reviewer" />' } as never,
    { account, route }
  );
  await flushPromises();
  return wrapper;
}

describe('Skill 生命周期', () => {
  it('active 技能显示 Archive 但不显示 Restore/Delete', async () => {
    useApiMock(() => ({ status: 200, json: permissions('active-published') }));
    await mountPanel();

    expect(wrapper!.find('[data-test="skill-context-status"]').text()).toContain('已发布');
    expect(wrapper!.find('[data-test="archive-skill"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="restore-skill"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="delete-skill"]').exists()).toBe(false);
  });

  it('archived 技能显示 Restore 与 Delete，删除上下文展示依赖方', async () => {
    const { requests } = useApiMock((method, url) => {
      if (method === 'GET' && url === '/api/skills/acme/reviewer/delete-context') {
        return {
          status: 200,
          json: {
            name: '@acme/reviewer',
            everPublished: true,
            releasesRemoved: 2,
            dependents: ['@acme/consumer']
          }
        };
      }
      return { status: 200, json: permissions('archived', { canArchive: false, canRestore: true, canDelete: true }) };
    });
    await mountPanel();

    expect(wrapper!.find('[data-test="skill-context-status"]').text()).toContain('已归档');
    await wrapper!.find('[data-test="delete-skill"]').trigger('click');
    await flushPromises();

    const context = wrapper!.find('[data-test="delete-context"]');
    expect(context.text()).toContain('2');
    expect(context.text()).toContain('@acme/consumer');
  });

  it('原因与完整身份校验通过后才提交删除', async () => {
    const { requests } = useApiMock((method, url) => {
      if (method === 'GET' && url === '/api/skills/acme/reviewer/delete-context') {
        return { status: 200, json: { name: '@acme/reviewer', everPublished: true, releasesRemoved: 1, dependents: [] } };
      }
      if (method === 'POST' && url === '/api/skills/acme/reviewer/delete') {
        return { status: 200, json: { deleted: true, name: '@acme/reviewer' } };
      }
      return { status: 200, json: permissions('archived', { canArchive: false, canRestore: true, canDelete: true }) };
    });
    await mountPanel();

    await wrapper!.find('[data-test="delete-skill"]').trigger('click');
    await flushPromises();

    const reason = wrapper!.find('textarea[data-test="delete-reason-input"]').element as HTMLTextAreaElement;
    reason.value = '治理清理';
    reason.dispatchEvent(new Event('input'));
    await flushPromises();
    const confirm = wrapper!.find('input[data-test="delete-confirm-input"]').element as HTMLInputElement;
    confirm.value = '@acme/reviewer';
    confirm.dispatchEvent(new Event('input'));
    await flushPromises();

    await wrapper!.find('[data-test="confirm-delete-skill"]').trigger('click');
    await flushPromises();

    const deletion = requests.find((request) => request.url === '/api/skills/acme/reviewer/delete');
    expect(deletion?.body).toEqual({ confirm: '@acme/reviewer', reason: '治理清理' });
  });

  it('删除失败显示服务端错误', async () => {
    useApiMock((method, url) => {
      if (method === 'GET' && url === '/api/skills/acme/reviewer/delete-context') {
        return { status: 200, json: { name: '@acme/reviewer', everPublished: true, releasesRemoved: 1, dependents: [] } };
      }
      if (method === 'POST' && url === '/api/skills/acme/reviewer/delete') {
        return { status: 409, json: { error: 'Failed to delete Git repository: Gitea unavailable' } };
      }
      return { status: 200, json: permissions('delete_failed', { canArchive: false, canRestore: false, canDelete: true }) };
    });
    await mountPanel();

    expect(wrapper!.find('[data-test="skill-context-status"]').text()).toContain('删除失败');
    await wrapper!.find('[data-test="delete-skill"]').trigger('click');
    await flushPromises();
    const reason = wrapper!.find('textarea[data-test="delete-reason-input"]').element as HTMLTextAreaElement;
    reason.value = '治理清理';
    reason.dispatchEvent(new Event('input'));
    await flushPromises();
    const confirm = wrapper!.find('input[data-test="delete-confirm-input"]').element as HTMLInputElement;
    confirm.value = '@acme/reviewer';
    confirm.dispatchEvent(new Event('input'));
    await flushPromises();
    await wrapper!.find('[data-test="confirm-delete-skill"]').trigger('click');
    await flushPromises();

    expect(wrapper!.find('.page-error').text()).toContain('Gitea unavailable');
  });

  it('从组织技能页签进入时，删除成功后回到该组织技能列表并保留位置', async () => {
    const { router } = await import('../src/router');
    useApiMock((method, url) => {
      if (method === 'GET' && url === '/api/skills/acme/reviewer/delete-context') {
        return { status: 200, json: { name: '@acme/reviewer', everPublished: true, releasesRemoved: 1, dependents: [] } };
      }
      if (method === 'POST' && url === '/api/skills/acme/reviewer/delete') {
        return { status: 200, json: { deleted: true, name: '@acme/reviewer' } };
      }
      return { status: 200, json: permissions('archived', { canArchive: false, canRestore: true, canDelete: true }) };
    });
    // 回退目标是组织技能页签：需要组织运营权，普通成员会被守卫送回组织列表。
    await mountPanel('/admin/me/skills/acme/reviewer/manage?from=org-skills&org=acme&tab=shared&page=3', 'owner');

    await wrapper!.find('[data-test="delete-skill"]').trigger('click');
    await flushPromises();
    const reason = wrapper!.find('textarea[data-test="delete-reason-input"]').element as HTMLTextAreaElement;
    reason.value = '治理清理';
    reason.dispatchEvent(new Event('input'));
    await flushPromises();
    const confirm = wrapper!.find('input[data-test="delete-confirm-input"]').element as HTMLInputElement;
    confirm.value = '@acme/reviewer';
    confirm.dispatchEvent(new Event('input'));
    await flushPromises();
    await wrapper!.find('[data-test="confirm-delete-skill"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('me-org-skills');
    expect(router.currentRoute.value.params.org).toBe('acme');
    expect(router.currentRoute.value.query).toEqual({ tab: 'shared', page: '3' });
  });
});
