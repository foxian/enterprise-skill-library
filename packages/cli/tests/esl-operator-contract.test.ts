import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAgentInteractionRequest, toAskUserQuestionPayload } from '../../core/src/agent-interaction.js';

const skillRoot = new URL('../../../skills/esl-operator/', import.meta.url);
const readSkill = (file: string) => fs.readFileSync(new URL(file, skillRoot), 'utf8');

// 检查随 CLI 发布的真实技能源码，不用测试夹具替代文档契约。
describe('esl-operator 文档契约', () => {
  it('保留关键命令与身份字段，防止正文断行丢字', () => {
    const content = readSkill('SKILL.md');
    for (const literal of ['Not logged in', '`name` 是身份的唯一权威来源', '改归属不得靠改 `name`', 'node -v', 'npm -v', 'npm install -g @foxian/esl', 'npm run build', 'npm exec -- esl', 'npx --yes @foxian/esl@<version>', 'npm install --prefix .esl-runtime @foxian/esl@<version>', 'ESL_SERVER=<url>']) {
      expect(content).toContain(literal);
    }
    expect(content).not.toMatch(/^\s*(?:ot logged in|ame|ode -v|pm (?:-v|install|run|exec))\x60/m);
  });

  it('覆盖受限沙箱中的 CLI 执行器 fallback', () => {
    const skill = readSkill('SKILL.md');
    const setup = readSkill('references/setup.md');
    const workflows = readSkill('references/workflows.md');
    expect(skill).toContain('Node/npm 存在不代表全局 npm 目录可写');
    expect(skill).toContain('不要推荐裸 `npx esl`');
    expect(setup).toContain('Node/npm 已存在但全局安装失败');
    expect(setup).toContain('宿主工具预装 `@foxian/esl`');
    expect(workflows).toContain('全局安装不是硬前置');
    expect(workflows).toContain('一次任务固定一个 CLI 执行器');
  });

  it('安装运行时范围与 CLI engines 一致', () => {
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    expect(readSkill('references/setup.md')).toContain(pkg.engines.node);
  });

  it('交互 JSON 示例与真实 CLI 输出一致', () => {
    const content = readSkill('references/agent-interaction.md');
    const example = content.match(/\x60{3}json\r?\n([\s\S]*?)\r?\n\x60{3}/);
    expect(example).not.toBeNull();
    const payload = toAskUserQuestionPayload(createAgentInteractionRequest({
      command: 'init', fields: [{ id: 'license', kind: 'text', label: 'License', default: 'MIT' }]
    }));
    expect(JSON.parse(example![1])).toEqual(payload);
    expect(content).not.toContain('根据 `kind` 渲染控件');
    expect(content).not.toContain('使用 `id` 作为参数键');
  });

  it('已发布包安装不把 Git 当成硬前置', () => {
    const row = readSkill('references/workflows.md').split(/\r?\n/).find((line) => line.startsWith('| 安装/更新远端技能 |'));
    expect(row).toBeDefined();
    expect(row).toContain('无需 Git');
  });
});
