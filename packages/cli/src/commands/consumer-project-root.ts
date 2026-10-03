import fs from 'node:fs/promises';
import path from 'node:path';
import { confirm, input, select } from '@inquirer/prompts';
import {
  AgentInteractionRequiredError,
  createAgentInteractionRequest,
  fileExists,
  saveSkillsJson,
  SUPPORTED_TOOLS,
  toolDirectory,
  validateSkillMd,
  type ToolName
} from '@esl/core';

// Consumer Project Root 发现（ADR-0057）：只用于项目级 link / unlink。
// 站在 Local Skill Source 里时把「技能目录的上一级」当作候选项目根，只看一层，
// 不向祖先搜索。hard evidence 静默采用；weak evidence 须确认；无证据三选一。

/** 项目级 Tool Link 的点目录，与 Tool Link 矩阵锁死（排除 OpenClaw 的裸 skills/）。 */
export function projectToolPointDirectories(): string[] {
  const probeRoot = process.platform === 'win32' ? 'C:\\__esl_probe__' : '/__esl_probe__';
  const dirs = new Set<string>();
  for (const tool of SUPPORTED_TOOLS) {
    if (tool === 'openclaw') {
      continue;
    }
    const toolSkillsDir = toolDirectory(tool, 'project', { projectRoot: probeRoot });
    const relative = path.relative(probeRoot, toolSkillsDir);
    const firstSegment = relative.split(path.sep).filter((segment) => segment.length > 0)[0];
    if (firstSegment) {
      dirs.add(firstSegment);
    }
  }
  return [...dirs];
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** 硬证据：目录里已有 Skill Dependency Manifest 或项目级 Skill Store。 */
export async function hasHardEvidence(directory: string): Promise<boolean> {
  return (
    (await fileExists(path.join(directory, '.skills.json'))) ||
    (await fileExists(path.join(directory, '.eslib')))
  );
}

/** 有效 Local Skill Source：存在可解析的 SKILL.md。子目录（如 references/）不是。 */
export async function isLocalSkillSource(directory: string): Promise<boolean> {
  const skillMdPath = path.join(directory, 'SKILL.md');
  if (!(await fileExists(skillMdPath))) {
    return false;
  }
  try {
    return validateSkillMd(await fs.readFile(skillMdPath, 'utf8')).success;
  } catch {
    return false;
  }
}

/** 弱证据：候选项目根里存在的项目级工具点目录。点目录存在即可，不要求 skills/。 */
export async function detectToolPointDirs(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const dirName of projectToolPointDirectories()) {
    if (await fileExists(path.join(directory, dirName))) {
      found.push(dirName);
    }
  }
  return found;
}

export interface ConsumerProjectRootContext {
  command: 'link' | 'unlink';
  global?: boolean;
  /** `-C` 之后的 cwd。 */
  cwd: string;
  /** 其上一级是候选项目根：link 传源码目录，unlink 传技能目录（显式 @identity 时传 cwd）。 */
  candidateDir: string;
  /** 调用方显式传入的项目根；只有缺省或等于 cwd 时才触发发现。 */
  projectRoot?: string;
}

export type ConsumerProjectRootInspection =
  | { kind: 'not-applicable'; projectRoot: string }
  | { kind: 'hard'; parent: string; projectRoot: string }
  | { kind: 'weak'; parent: string; toolDirs: string[] }
  | { kind: 'none'; parent: string };

export async function inspectConsumerProjectRoot(
  context: ConsumerProjectRootContext
): Promise<ConsumerProjectRootInspection> {
  const cwd = path.resolve(context.cwd);
  if (context.global) {
    return { kind: 'not-applicable', projectRoot: cwd };
  }
  if (context.projectRoot !== undefined && !samePath(context.projectRoot, cwd)) {
    return { kind: 'not-applicable', projectRoot: context.projectRoot };
  }
  if (await hasHardEvidence(cwd)) {
    return { kind: 'not-applicable', projectRoot: cwd };
  }
  if (!(await isLocalSkillSource(cwd))) {
    return { kind: 'not-applicable', projectRoot: cwd };
  }
  const parent = path.dirname(path.resolve(context.candidateDir));
  if (samePath(parent, cwd)) {
    return { kind: 'not-applicable', projectRoot: cwd };
  }
  if (await hasHardEvidence(parent)) {
    return { kind: 'hard', parent, projectRoot: parent };
  }
  const toolDirs = await detectToolPointDirs(parent);
  if (toolDirs.length > 0) {
    return { kind: 'weak', parent, toolDirs };
  }
  return { kind: 'none', parent };
}

/**
 * 命令层静默解析：只采用 hard evidence（ADR-0057 的成功路径）。
 * weak/none 的交互由 bin 层在调用命令前完成；直接调用命令时保持 cwd。
 */
export async function resolveProjectRootSilently(
  context: ConsumerProjectRootContext
): Promise<string> {
  const inspection = await inspectConsumerProjectRoot(context);
  if (inspection.kind === 'hard') {
    return inspection.parent;
  }
  return context.projectRoot ?? path.resolve(context.cwd);
}

/** 在项目根写出项目级 Manifest 与 Store（选「初始化上一级」时使用）。 */
export async function initializeConsumerProjectRoot(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  await saveSkillsJson(resolved, { skills: {} });
  await fs.mkdir(path.join(resolved, '.eslib', 'skills'), { recursive: true });
}

/**
 * `list` / `tools` / `uninstall` 的提示：站在 Local Skill Source 且上一级有
 * 硬证据时，不替调用方改读父 Store，只提示去那里或使用 `-C`。
 */
export async function consumerProjectRootHint(options: {
  global?: boolean;
  cwd?: string;
} = {}): Promise<string | null> {
  if (options.global) {
    return null;
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (await hasHardEvidence(cwd)) {
    return null;
  }
  if (!(await isLocalSkillSource(cwd))) {
    return null;
  }
  const parent = path.dirname(cwd);
  if (samePath(parent, cwd) || !(await hasHardEvidence(parent))) {
    return null;
  }
  return `This directory is a Local Skill Source; the project Skill Store is at ${parent}. Run the command there, or use \`-C ${parent}\`.`;
}

/**
 * `install` / `update` 的主语是 Skill Store，必须站在 Consumer Project Root 执行。
 * 站在无 Manifest/Store 的 Local Skill Source 里拒绝写入，避免把技能源码写成
 * 嵌套消费方（ADR-0057）。技能目录自己已有硬证据时它就是项目根，放行。
 */
export async function assertNotNestedConsumerStore(options: {
  command: 'install' | 'update';
  global?: boolean;
  projectRoot?: string;
  cwd?: string;
}): Promise<void> {
  if (options.global) {
    return;
  }
  const directory = path.resolve(options.projectRoot ?? options.cwd ?? process.cwd());
  if (await hasHardEvidence(directory)) {
    return;
  }
  if (!(await isLocalSkillSource(directory))) {
    return;
  }
  const parent = path.dirname(directory);
  const error = new Error(
    `Refusing to create a nested Skill Store inside the Local Skill Source ${directory}. ` +
      `Run this from the Consumer Project Root, or pass --global. ` +
      `To use the parent directory as the project root: esl -C ${parent}.`
  ) as Error & { code?: string; params?: Record<string, string> };
  error.code = 'consumerProjectRootNestedStoreRefused';
  error.params = { directory, parent };
  throw error;
}

export interface AgentProjectRootParams {
  useParent?: boolean;
  projectRootChoice?: string;
  projectRootPath?: string;
}

export interface ResolveConsumerProjectRootOptions extends ConsumerProjectRootContext {
  interactive: boolean;
  agentMode: boolean;
  params?: AgentProjectRootParams;
  agentTool?: ToolName;
}

export type ConsumerProjectRootResolution =
  | { kind: 'project'; projectRoot: string }
  | { kind: 'global' };

function toolDirsList(toolDirs: string[]): string {
  return toolDirs.map((dir) => `\`${dir}\``).join(', ');
}

function weakEvidenceMessage(parent: string, toolDirs: string[]): string {
  return (
    `This directory is a Local Skill Source. Found ESL project tool directories next to ${parent}: ` +
    `${toolDirsList(toolDirs)}. Use ${parent} as the Consumer Project Root?`
  );
}

const NO_EVIDENCE_CHOICE_OPTIONS = [
  {
    label: 'Initialize the parent directory as a Consumer Project Root',
    value: 'init',
    description: 'Writes .skills.json and .eslib/ in the parent directory'
  },
  {
    label: 'Use another directory as the Consumer Project Root',
    value: 'directory',
    description: 'Pick an existing project directory'
  },
  {
    label: 'Use the global Skill Store instead',
    value: 'global',
    description: 'Link into ~/.eslib without a project'
  }
] as const;

type NoEvidenceChoice = (typeof NO_EVIDENCE_CHOICE_OPTIONS)[number]['value'];

const NO_EVIDENCE_CHOICE_VALUES = new Set<string>(
  NO_EVIDENCE_CHOICE_OPTIONS.map((option) => option.value)
);

/**
 * Agent 宿主按 `label` 回传，TTY 用 `value`；两者都接受。
 * 见 references/agent-interaction.md（单选取所选 label）。
 */
function resolveNoEvidenceChoice(value: string): NoEvidenceChoice | undefined {
  if (NO_EVIDENCE_CHOICE_VALUES.has(value)) {
    return value as NoEvidenceChoice;
  }
  return NO_EVIDENCE_CHOICE_OPTIONS.find((option) => option.label === value)?.value;
}

function noEvidenceMessage(parent: string): string {
  return (
    `This directory is a Local Skill Source and its parent ${parent} has no .skills.json or .eslib, ` +
    'so ESL cannot tell which directory is the Consumer Project Root. Choose one of: ' +
    'initialize the parent as a Consumer Project Root; use another directory; use the global Skill Store.'
  );
}

function weakEvidenceRequiredMessage(parent: string, toolDirs: string[]): string {
  return (
    `This directory is a Local Skill Source with no .skills.json or .eslib; found ESL project tool ` +
    `directories next to ${parent}: ${toolDirsList(toolDirs)}. Use ${parent} as the Consumer Project ` +
    'Root (default), initialize it as a Consumer Project Root, use another directory, or pass --global.'
  );
}

function errorWithCode(message: string, code: string, params: Record<string, string>): Error {
  const error = new Error(message) as Error & { code?: string; params?: Record<string, string> };
  error.code = code;
  error.params = params;
  return error;
}

function consumerProjectRootRequiredError(parent: string): Error {
  return errorWithCode(noEvidenceMessage(parent), 'consumerProjectRootRequired', { directory: parent });
}

function weakEvidenceRequiredError(parent: string, toolDirs: string[]): Error {
  return errorWithCode(
    weakEvidenceRequiredMessage(parent, toolDirs),
    'consumerProjectRootWeakEvidenceRequired',
    { directory: parent }
  );
}

function projectRootChoiceField(parent: string) {
  return {
    id: 'projectRootChoice',
    kind: 'select' as const,
    label: noEvidenceMessage(parent),
    required: true,
    // Agent 宿主按 label 回传，TTY 用 value；两者都能被 applyNoEvidenceChoice 识别。
    default: NO_EVIDENCE_CHOICE_OPTIONS[0].label,
    options: NO_EVIDENCE_CHOICE_OPTIONS.map((option) => ({
      label: option.label,
      description: `choice: ${option.value}`
    }))
  };
}

function projectRootPathField() {
  return {
    id: 'projectRootPath',
    kind: 'path' as const,
    label: 'Consumer Project Root directory (when using another directory)',
    required: false
  };
}

function weakEvidenceField(parent: string, toolDirs: string[]) {
  return {
    id: 'useParent',
    kind: 'confirm' as const,
    label: weakEvidenceMessage(parent, toolDirs),
    required: true,
    default: true
  };
}

async function chooseNoEvidence(
  options: ResolveConsumerProjectRootOptions,
  parent: string
): Promise<ConsumerProjectRootResolution> {
  const suppliedChoice = options.params?.projectRootChoice;
  if (suppliedChoice !== undefined) {
    const choice = resolveNoEvidenceChoice(suppliedChoice);
    if (!choice) {
      throw new Error(`Unknown Consumer Project Root choice: ${suppliedChoice}`);
    }
    return applyNoEvidenceChoice(options, parent, choice, options.params?.projectRootPath);
  }

  if (options.agentMode) {
    throw new AgentInteractionRequiredError(
      createAgentInteractionRequest({
        command: options.command,
        fields: [projectRootChoiceField(parent), projectRootPathField()],
        agentTool: options.agentTool
      })
    );
  }

  if (options.interactive) {
    const choice = await select<NoEvidenceChoice>({
      message: noEvidenceMessage(parent),
      choices: NO_EVIDENCE_CHOICE_OPTIONS.map((option) => ({
        name: option.label,
        value: option.value
      }))
    });
    let directory: string | undefined;
    if (choice === 'directory') {
      directory = await input({ message: 'Consumer Project Root directory' });
    }
    return applyNoEvidenceChoice(options, parent, choice, directory);
  }

  throw consumerProjectRootRequiredError(parent);
}

async function applyNoEvidenceChoice(
  options: ResolveConsumerProjectRootOptions,
  parent: string,
  choice: NoEvidenceChoice,
  directory: string | undefined
): Promise<ConsumerProjectRootResolution> {
  switch (choice) {
    case 'init':
      await initializeConsumerProjectRoot(parent);
      return { kind: 'project', projectRoot: parent };
    case 'directory': {
      if (!directory || directory.trim().length === 0) {
        throw new Error('A Consumer Project Root directory is required when choosing another directory');
      }
      return { kind: 'project', projectRoot: path.resolve(options.cwd, directory) };
    }
    case 'global':
      return { kind: 'global' };
  }
}

export async function resolveConsumerProjectRoot(
  options: ResolveConsumerProjectRootOptions
): Promise<ConsumerProjectRootResolution> {
  const inspection = await inspectConsumerProjectRoot(options);

  if (inspection.kind === 'not-applicable' || inspection.kind === 'hard') {
    return { kind: 'project', projectRoot: inspection.projectRoot };
  }

  if (inspection.kind === 'weak') {
    const useParent = options.params?.useParent;
    if (useParent === true) {
      return { kind: 'project', projectRoot: inspection.parent };
    }
    if (useParent === false) {
      return chooseNoEvidence(options, inspection.parent);
    }
    if (options.agentMode) {
      throw new AgentInteractionRequiredError(
        createAgentInteractionRequest({
          command: options.command,
          fields: [weakEvidenceField(inspection.parent, inspection.toolDirs)],
          agentTool: options.agentTool
        })
      );
    }
    if (options.interactive) {
      const proceed = await confirm({
        message: weakEvidenceMessage(inspection.parent, inspection.toolDirs),
        default: true
      });
      if (proceed) {
        return { kind: 'project', projectRoot: inspection.parent };
      }
      return chooseNoEvidence(options, inspection.parent);
    }
    throw weakEvidenceRequiredError(inspection.parent, inspection.toolDirs);
  }

  return chooseNoEvidence(options, inspection.parent);
}
