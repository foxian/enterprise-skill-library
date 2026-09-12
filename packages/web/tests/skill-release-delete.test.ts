import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import SkillManagePanel from '../src/components/SkillManagePanel.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

function skillContext() {
  return {
    name: '@acme/reviewer',
    description: 'Reviewer skill',
    status: 'active-published',
    createdBy: 'acme_alice',
    releases: [
      {
        version: '1.2.0',
        createdAt: '2026-09-01T00:00:00.000Z',
        notes: 'latest',
        deprecatedMessage: null,
        sourceCommit: 'abc1234',
        createdBy: 'acme_alice'
      },
      {
        version: '1.0.0',
        createdAt: '2026-08-01T00:00:00.000Z',
        notes: 'bad release',
        deprecatedMessage: null,
        sourceCommit: 'def5678',
        createdBy: 'acme_alice'
      }
    ]
  };
}

function matrixWithContext(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'acme',
    skillName: 'reviewer',
    sharedAllRead: false,
    sharedAllWrite: false,
    teams: [],
    members: [{ username: 'acme_alice', permission: 'write' }],
    skill: skillContext(),
    ...overrides
  };
}

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

async function mountPanel() {
  wrapper = await mountConsoleView(
    { components: { SkillManagePanel }, template: '<SkillManagePanel scope="acme" skill-name="reviewer" />' } as never,
    { role: 'member', route: '/admin/member/skills' }
  );
  await flushPromises();
  return wrapper;
}

function messageBox(): HTMLElement | null {
  return document.querySelector('.el-message-box');
}

function messageBoxInput(): HTMLInputElement | null {
  return document.querySelector('.el-message-box__input input');
}

function messageBoxButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('.el-message-box__btns button')) as HTMLButtonElement[];
}

/** prompt 的输入框需要真的派发 input 事件，Vue 才会同步到内部状态 */
async function fillVersion(version: string): Promise<void> {
  const input = messageBoxInput()!;
  input.value = version;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}

describe('单版本删除', () => {
  it('发布历史里每个 Release 都有删除入口', async () => {
    useApiMock(() => ({ status: 200, json: matrixWithContext() }));
    await mountPanel();

    expect(wrapper!.find('[data-test="release-history-table"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="delete-release-1.2.0"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="delete-release-1.0.0"]').exists()).toBe(true);
  });

  it('回显版本号确认后才提交删除请求', async () => {
    const { requests } = useApiMock((method, url) => {
      if (method === 'POST' && url === '/api/skills/acme/reviewer/releases/1.0.0/delete') {
        return { status: 200, json: { deleted: true, version: '1.0.0', dependents: [] } };
      }
      return { status: 200, json: matrixWithContext() };
    });
    await mountPanel();

    await wrapper!.find('[data-test="delete-release-1.0.0"]').trigger('click');
    await flushPromises();
    expect(messageBox()).not.toBeNull();

    await fillVersion('1.0.0');
    const [, confirm] = messageBoxButtons();
    confirm.click();
    await flushPromises();

    const deletion = requests.find((request) => request.url.endsWith('/releases/1.0.0/delete'));
    expect(deletion?.method).toBe('POST');
    expect(deletion?.body).toEqual({ confirm: '1.0.0' });
  });

  it('版本号不匹配时拒绝提交', async () => {
    const { requests } = useApiMock(() => ({ status: 200, json: matrixWithContext() }));
    await mountPanel();

    await wrapper!.find('[data-test="delete-release-1.0.0"]').trigger('click');
    await flushPromises();

    await fillVersion('9.9.9');
    const [, confirm] = messageBoxButtons();
    confirm.click();
    await flushPromises();

    expect(requests.some((request) => request.url.endsWith('/delete'))).toBe(false);
    expect(wrapper!.find('.page-error').text()).toContain('1.0.0');
  });

  it('服务端因依赖引用拒绝时列出引用方', async () => {
    useApiMock((method, url) => {
      if (method === 'POST' && url === '/api/skills/acme/reviewer/releases/1.0.0/delete') {
        return {
          status: 409,
          json: {
            error:
              'Release 1.0.0 is required by @acme/dependent; deleting it would break their installs. Pass force to override.'
          }
        };
      }
      return { status: 200, json: matrixWithContext() };
    });
    await mountPanel();

    await wrapper!.find('[data-test="delete-release-1.0.0"]').trigger('click');
    await flushPromises();
    await fillVersion('1.0.0');
    const [, confirm] = messageBoxButtons();
    confirm.click();
    await flushPromises();

    expect(wrapper!.find('.page-error').text()).toContain('@acme/dependent');
  });
});
