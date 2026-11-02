import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAgentInteractionRequest, toAskUserQuestionPayload } from '../../core/src/agent-interaction.js';
import { SUPPORTED_TOOLS, TOOL_DISPLAY_NAMES } from '../../core/src/link/tool-links.js';

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
    expect(skill).toContain('直接执行用户明确要求的 ESL 命令');
    expect(skill).toContain('同一任务内已成功确认的 CLI、Server、登录和 Git 状态直接复用');
    expect(setup).toContain('先直接执行用户要求的 ESL 命令');
    expect(workflows).toContain('只有失败或进入新阶段时才补做缺失检查');
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
      command: 'init',
      fields: [{ id: 'namespace', kind: 'select', label: 'Namespace', options: ['personal', 'acme'] }]
    }));
    expect(JSON.parse(example![1])).toEqual(payload);
    expect(content).not.toContain('根据 `kind` 渲染控件');
    expect(content).not.toContain('使用 `id` 作为参数键');
  });

  it('同步依赖清理、影响确认与身份式声明说明', () => {
    const skill = readSkill('SKILL.md');
    const consumer = readSkill('references/consumer.md');
    const author = readSkill('references/author.md');
    const agent = readSkill('references/agent-interaction.md');
    expect(skill).toContain('esl skill update');
    expect(skill).toContain('esl skill uninstall');
    expect(consumer).toContain('--cleanup');
    expect(consumer).toContain('missingDependencies');
    expect(consumer).toContain('--accept-dependency-impact');
    expect(author).toContain('通配范围');
    expect(agent).toContain('acceptDependencyImpact');
  });

  it('工具表覆盖受支持工具与展示名，并说明宿主提问', () => {
    const skill = readSkill('SKILL.md');
    for (const tool of SUPPORTED_TOOLS) {
      expect(skill, `工具 id ${tool} 缺失`).toContain(`\`${tool}\``);
    }
    expect(skill).toContain('`claude-code`');
    for (const displayName of Object.values(TOOL_DISPLAY_NAMES)) {
      expect(skill, `工具展示名 ${displayName} 缺失`).toContain(displayName);
    }
    expect(skill).toContain('AskUserQuestion');
  });

  it('静态命令不再默认追加 Agent Interaction 旗标', () => {
    const skill = readSkill('SKILL.md');
    const consumer = readSkill('references/consumer.md');
    const author = readSkill('references/author.md');
    expect(skill).not.toContain('Agent Interaction 默认开启');
    expect(skill).not.toContain('命令一律追加');
    expect(consumer).not.toContain('固定带 `--agent-interaction');
    expect(author).not.toContain('固定带 `--agent-interaction');
    const versionLine = author.split(/\r?\n/).find((line) => line.startsWith('`esl release version'));
    expect(versionLine).toBeDefined();
    expect(versionLine).not.toContain('--agent-interaction');
  });

  it('协议文档只保留服务端与运行时问题', () => {
    const agent = readSkill('references/agent-interaction.md');
    expect(agent).toContain('acceptDependencyImpact');
    expect(agent).toContain('cleanup');
    expect(agent).not.toContain('install / link：只问工具多选');
    expect(agent).not.toContain('link / unlink：站在 Local Skill Source 里的项目根');
    expect(agent).not.toContain('--agent-interaction --tools');
  });

  it('init 先传静态字段，只有 Namespace 走协议', () => {
    const author = readSkill('references/author.md');
    const agent = readSkill('references/agent-interaction.md');
    expect(author).toContain('--namespace personal');
    expect(author).toContain('--display-name');
    expect(author).toContain(`--params-json '{"namespace"`);
    expect(agent).toContain('只包含 Namespace');
  });

  it('项目根判断落在 consumer reference', () => {
    const consumer = readSkill('references/consumer.md');
    expect(consumer).toContain('useParent');
    expect(consumer).toContain('projectRootChoice');
    expect(consumer).toContain('choice:');
  });

  it('已发布包安装不把 Git 当成硬前置', () => {
    const row = readSkill('references/workflows.md').split(/\r?\n/).find((line) => line.startsWith('| 安装/更新远端技能 |'));
    expect(row).toBeDefined();
    expect(row).toContain('无需 Git');
  });
});
