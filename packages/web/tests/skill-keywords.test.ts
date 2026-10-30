import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import SkillManagePanel from '../src/components/SkillManagePanel.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

// 技能详情页关键词标签（#142）：关键词随 permissions 响应的技能上下文下发，
// 有值时以标签展示原始文本；无值时不渲染空容器。
let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

function mockPanel(keywords: string[] | undefined): void {
  useApiMock((_method, url) => {
    if (url.includes('/permission-candidates')) {
      return { status: 200, json: { teams: [], members: [] } };
    }
    if (url === '/api/skills/acme/reviewer/permissions') {
      return {
        status: 200,
        json: {
          scope: 'acme',
          skillName: 'reviewer',
          sharedAllRead: false,
          sharedAllWrite: false,
          sharedAllManage: false,
          teams: [],
          members: [{ username: 'alice', permission: 'write' }],
          viewerAccess: 'manage',
          skill: {
            name: '@acme/reviewer',
            description: '共享评审技能',
            status: 'active-published',
            createdBy: 'alice',
            ...(keywords === undefined ? {} : { keywords }),
            releases: []
          }
        }
      };
    }
    return { status: 200, json: [] };
  });
}

async function mountPanel(): Promise<VueWrapper> {
  const mounted = await mountConsoleView(
    { components: { SkillManagePanel }, template: '<SkillManagePanel scope="acme" skill-name="reviewer" />' } as never,
    { account: 'member', route: '/admin/me/skills' }
  );
  await flushPromises();
  return mounted;
}

describe('技能详情页关键词', () => {
  it('展示当前 Release 的关键词标签，并保留原始文本', async () => {
    mockPanel(['Code Review', 'review']);
    wrapper = await mountPanel();

    const container = wrapper.find('[data-test="skill-keywords"]');
    expect(container.exists()).toBe(true);
    expect(container.text()).toContain('关键词');
    const chips = wrapper.findAll('[data-test="skill-keyword"]');
    expect(chips.map((chip) => chip.text())).toEqual(['Code Review', 'review']);
  });

  it('关键词较多或较长时全部渲染，并允许容器换行', async () => {
    const many = ['a'.repeat(120), ...Array.from({ length: 12 }, (_, index) => `keyword-${index}`)];
    mockPanel(many);
    wrapper = await mountPanel();

    const container = wrapper.find('[data-test="skill-keywords"]');
    expect(container.exists()).toBe(true);
    // el-space 的 wrap 在容器上产出 flex-wrap，长标签由组件样式在标签内折行。
    expect(container.attributes('style') ?? '').toContain('flex-wrap: wrap');
    expect(wrapper.findAll('[data-test="skill-keyword"]')).toHaveLength(many.length);
  });

  it('没有关键词时不渲染空容器', async () => {
    mockPanel([]);
    wrapper = await mountPanel();

    expect(wrapper.find('[data-test="skill-keywords"]').exists()).toBe(false);
  });

  it('旧服务端不返回 keywords 字段时同样不渲染空容器', async () => {
    mockPanel(undefined);
    wrapper = await mountPanel();

    expect(wrapper.find('[data-test="skill-keywords"]').exists()).toBe(false);
  });
});
