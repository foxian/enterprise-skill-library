import { describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import ElementPlus, { ElTooltip } from 'element-plus';
import SkillIdentity from '../src/components/SkillIdentity.vue';

const skill = {
  name: '@acme/code-review', skillName: 'code-review', displayName: '代码审查',
  description: '检查规范、缺陷和安全问题。'.repeat(40), personalNamespace: false
};

describe('统一技能信息', () => {
  it('按名称、完整描述预览、归属与标识排列，并支持聚焦查看全文', () => {
    const wrapper = mount(SkillIdentity, { props: { skill }, global: { plugins: [createPinia(), ElementPlus] } });
    expect(wrapper.find('[data-test="skill-display-name"]').text()).toBe('代码审查');
    const preview = wrapper.find('[data-test="skill-description-preview"]');
    expect(preview.text()).toBe(skill.description);
    expect(preview.attributes('tabindex')).toBe('0');
    expect(wrapper.findComponent(ElTooltip).props('content')).toBe(skill.description);
    expect(wrapper.findComponent(ElTooltip).props('trigger')).toEqual(['hover', 'focus']);
    expect(wrapper.text().indexOf(skill.description)).toBeLessThan(wrapper.text().indexOf(skill.name));
    wrapper.unmount();
  });

  it('无描述时省略预览，锁定命名空间隐藏徽标，缺少显示名回退短名', () => {
    const wrapper = mount(SkillIdentity, {
      props: { skill: { ...skill, description: '  ', displayName: undefined }, showNamespaceBadge: false },
      global: { plugins: [createPinia(), ElementPlus] }
    });
    expect(wrapper.find('[data-test="skill-display-name"]').text()).toBe('code-review');
    expect(wrapper.find('[data-test="skill-description-preview"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="scope-badge"]').exists()).toBe(false);
    expect(wrapper.find('code').text()).toBe(skill.name);
    wrapper.unmount();
  });
});
