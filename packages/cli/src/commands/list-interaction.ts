import { checkbox, confirm, select } from '@inquirer/prompts';
import {
  loadInstallManifest,
  parseSkillIdentity,
  reconcileToolLinks,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  SUPPORTED_TOOLS,
  toolDisplayName,
  type InstallManifest,
  type ReconcileToolLinksOptions,
  type ReconcileToolLinksResult,
  type SkillListEntry,
  type ToolName
} from '@esl/core';
import { executeList } from './list.js';
import { executeUpdate, type UpdateResult } from './update.js';
import { executeUninstall, type UninstallResult } from './uninstall.js';
import { executeUnlink, type UnlinkResult } from './unlink.js';

// `esl list` 交互管理台（ADR-0055）：两级浏览（列表 → 详情与动作）。模式判断与
// 确认门闩归 CLI 交互层；uninstall / unlink / update / 期望 Tool Link 集合对账
// 复用既有命令的执行路径，不另起第二套业务实现。依赖全部可注入，程序边界测试
// 不耦合 Inquirer 内部实现。

const EXIT = '__exit__';
const ACTION_BACK = 'back';
// 详情层与第一级共用同一个退出哨兵，避免两套值漂移。
const ACTION_EXIT = EXIT;
const ACTION_UPDATE = 'update';
const ACTION_TOOLS = 'tools';
const ACTION_UNLINK = 'unlink';
const ACTION_UNINSTALL = 'uninstall';

export interface ListSessionOptions {
  global?: boolean;
}

export interface ListSessionDeps {
  select?: typeof select;
  checkbox?: typeof checkbox;
  confirm?: typeof confirm;
  list?: (options: { global?: boolean }) => Promise<SkillListEntry[]>;
  loadManifest?: typeof loadInstallManifest;
  uninstall?: (name: string, options: { global?: boolean }) => Promise<UninstallResult>;
  unlink?: (target: string | undefined, options: { global?: boolean }) => Promise<UnlinkResult>;
  update?: (options: { skillName?: string; global?: boolean }) => Promise<UpdateResult>;
  reconcile?: (options: ReconcileToolLinksOptions) => Promise<ReconcileToolLinksResult>;
}

interface ResolvedDeps {
  selectPrompt: typeof select;
  checkboxPrompt: typeof checkbox;
  confirmPrompt: typeof confirm;
  list: (options: { global?: boolean }) => Promise<SkillListEntry[]>;
  loadManifest: typeof loadInstallManifest;
  uninstall: NonNullable<ListSessionDeps['uninstall']>;
  unlink: NonNullable<ListSessionDeps['unlink']>;
  update: NonNullable<ListSessionDeps['update']>;
  reconcile: NonNullable<ListSessionDeps['reconcile']>;
}

export function skillListTitle(entry: SkillListEntry): string {
  if (entry.displayName && entry.displayName.length > 0) {
    return entry.displayName;
  }
  return parseSkillIdentity(entry.name)?.shortName ?? entry.name;
}

function level1ChoiceLabel(entry: SkillListEntry): string {
  return `${skillListTitle(entry)}  ${entry.name}  v${entry.version}  (${entry.source})`;
}

function storeRootFor(options: ListSessionOptions): string {
  return options.global
    ? resolveLocalStorePaths({}).root
    : resolveProjectStorePaths(process.cwd()).root;
}

function printSkillDetail(entry: SkillListEntry, manifest: InstallManifest): void {
  const manifestEntry = manifest.skills[entry.name];
  console.log('');
  console.log(
    entry.displayName && entry.displayName !== entry.name
      ? `${entry.name} — ${entry.displayName}`
      : entry.name
  );
  console.log(`Identity: ${entry.name}`);
  console.log(`Version: ${entry.version}`);
  console.log(`Source: ${entry.source}`);
  if (manifestEntry?.installedAt) {
    console.log(`Installed at: ${manifestEntry.installedAt}`);
  }
  if (manifestEntry?.sourceDir) {
    console.log(`Store path: ${manifestEntry.sourceDir}`);
  }
  if (entry.source === 'link') {
    console.log(`Link source: ${entry.linkSourcePath ?? '(unknown; the manifest has no resolved path)'}`);
  }
  if (entry.tools && entry.tools.length > 0) {
    console.log('Tool links:');
    for (const link of entry.tools) {
      console.log(`  ${toolDisplayName(link.tool)} (${link.tool}): ${link.status} (${link.managed ? 'managed' : 'unmanaged'})`);
    }
  } else {
    console.log('Tool links: none');
  }
}

// 动作按 source 分流：source=link 主推 unlink（并声明 Link Staging 恢复语义），
// uninstall 声明保留源码目录；builtin 等其他来源没有 unlink，不点了再报错。
function detailActionChoices(entry: SkillListEntry): Array<{ name: string; value: string; description?: string }> {
  const choices: Array<{ name: string; value: string; description?: string }> = [
    { name: 'Update to the latest version', value: ACTION_UPDATE },
    { name: 'Adjust tool links…', value: ACTION_TOOLS }
  ];
  if (entry.source === 'link') {
    choices.push({
      name: 'Unlink Skill Source Link (unlink)',
      value: ACTION_UNLINK,
      description:
        'Removes the Skill Source Link; a staged store copy (Link Staging) is restored locally when present. The source directory is kept.'
    });
    choices.push({
      name: 'Uninstall (remove the store link and records; keeps the source directory)',
      value: ACTION_UNINSTALL
    });
  } else {
    choices.push({ name: 'Uninstall', value: ACTION_UNINSTALL });
  }
  return choices;
}

async function runDetailUpdate(
  entry: SkillListEntry,
  options: ListSessionOptions,
  deps: ResolvedDeps
): Promise<void> {
  const proceed = await deps.confirmPrompt({
    message: `Update ${entry.name} to the latest applicable version?`,
    default: false
  });
  if (!proceed) {
    console.log('Update cancelled; nothing changed.');
    return;
  }
  const results = await deps.update({ skillName: entry.name, global: options.global });
  if (results.length === 0) {
    console.log(`${entry.name} is up to date.`);
    return;
  }
  for (const result of results) {
    console.log(
      result.skipped === 'link'
        ? `${result.name}: linked (skipped)`
        : `${result.name}: ${result.from} -> ${result.to}`
    );
  }
}

async function runDetailTools(
  entry: SkillListEntry,
  options: ListSessionOptions,
  deps: ResolvedDeps
): Promise<void> {
  const existing = (entry.tools ?? []).filter((link) => link.managed).map((link) => link.tool);
  const selected = await deps.checkboxPrompt<ToolName>({
    message: `Select the expected tool link set for ${entry.name}`,
    choices: SUPPORTED_TOOLS.map((tool) => ({
      name: toolDisplayName(tool),
      value: tool,
      checked: existing.includes(tool)
    })),
    required: false
  });
  const additions = selected.filter((tool) => !existing.includes(tool));
  const removals = existing.filter((tool) => !selected.includes(tool));
  if (additions.length === 0 && removals.length === 0) {
    console.log('Tool links already match the selection; nothing to change.');
    return;
  }
  if (additions.length > 0) {
    console.log(`Will add: ${additions.map(toolDisplayName).join(', ')}`);
  }
  if (removals.length > 0) {
    console.log(`Will remove (ESL-managed only): ${removals.map(toolDisplayName).join(', ')}`);
  }
  const proceed = await deps.confirmPrompt({
    message: `Apply the expected tool link set for ${entry.name}?`,
    default: false
  });
  if (!proceed) {
    console.log('Tool link adjustment cancelled; nothing changed.');
    return;
  }
  const result = await deps.reconcile({
    storeRoot: storeRootFor(options),
    identity: entry.name,
    level: options.global ? 'global' : 'project',
    tools: selected
  });
  if (result.status === 'reconciled') {
    console.log(`Tool links reconciled for ${entry.name}.`);
    for (const ensured of result.ensured) {
      console.log(`  ${toolDisplayName(ensured.tool)}: ${ensured.status}`);
    }
    for (const removed of result.removed) {
      console.log(`  ${toolDisplayName(removed.tool)}: removed`);
    }
    return;
  }
  console.log(`Tool link reconciliation failed for ${entry.name}; existing links are kept.`);
  for (const failure of result.failures) {
    const detail = 'error' in failure && failure.error ? `: ${failure.error}` : '';
    console.log(`  ${toolDisplayName(failure.tool)}: ${failure.status}${detail}`);
  }
}

async function runDetailUnlink(
  entry: SkillListEntry,
  options: ListSessionOptions,
  deps: ResolvedDeps
): Promise<boolean> {
  const sourceNote = entry.linkSourcePath
    ? ` The source directory at ${entry.linkSourcePath} is kept.`
    : ' The source directory is kept.';
  const proceed = await deps.confirmPrompt({
    message: `Unlink ${entry.name}? The Skill Source Link and store records are removed; a staged store copy (Link Staging) is restored locally when present.${sourceNote}`,
    default: false
  });
  if (!proceed) {
    console.log('Unlink cancelled; nothing changed.');
    return false;
  }
  const result = await deps.unlink(entry.name, { global: options.global });
  console.log(
    result.restored
      ? `Skill ${result.identity} unlinked; previous store copy restored at ${result.targetDir}`
      : `Skill ${result.identity} unlinked`
  );
  return true;
}

async function runDetailUninstall(
  entry: SkillListEntry,
  options: ListSessionOptions,
  deps: ResolvedDeps
): Promise<boolean> {
  const message =
    entry.source === 'link'
      ? `Uninstall ${entry.name}? The store link, records and tool links are removed; the source directory is NOT deleted.`
      : `Uninstall ${entry.name}? The installed copy, records and tool links are removed.`;
  const proceed = await deps.confirmPrompt({ message, default: false });
  if (!proceed) {
    console.log('Uninstall cancelled; nothing changed.');
    return false;
  }
  const result = await deps.uninstall(entry.name, { global: options.global });
  console.log(
    result.sourceRemoved
      ? `Skill ${entry.name} uninstalled`
      : `Skill ${entry.name} uninstalled; linked source was preserved at ${result.sourcePath}`
  );
  return true;
}

export async function runListSession(
  options: ListSessionOptions = {},
  deps: ListSessionDeps = {}
): Promise<void> {
  const resolved: ResolvedDeps = {
    selectPrompt: deps.select ?? select,
    checkboxPrompt: deps.checkbox ?? checkbox,
    confirmPrompt: deps.confirm ?? confirm,
    list: deps.list ?? ((sessionOptions: { global?: boolean }) => executeList(sessionOptions)),
    loadManifest: deps.loadManifest ?? loadInstallManifest,
    uninstall: deps.uninstall ?? ((name, uninstallOptions) => executeUninstall(name, uninstallOptions)),
    unlink: deps.unlink ?? ((target, unlinkOptions) => executeUnlink(target, unlinkOptions)),
    update: deps.update ?? ((updateOptions) => executeUpdate(updateOptions)),
    reconcile: deps.reconcile ?? ((reconcileOptions) => reconcileToolLinks(reconcileOptions))
  };

  for (;;) {
    const entries = await resolved.list({ global: options.global });
    if (entries.length === 0) {
      console.log(options.global ? 'No global skills installed.' : 'No skills installed in this project.');
      return;
    }
    const chosen = await resolved.selectPrompt({
      message: options.global ? 'Select a global skill to manage' : 'Select a skill to manage',
      choices: [
        ...entries.map((entry) => ({ name: level1ChoiceLabel(entry), value: entry.name })),
        { name: 'Exit', value: EXIT }
      ]
    });
    if (chosen === EXIT) {
      return;
    }
    const navigation = await runSkillDetail(chosen, options, resolved);
    if (navigation === 'exit') {
      return;
    }
  }
}

async function runSkillDetail(
  identity: string,
  options: ListSessionOptions,
  deps: ResolvedDeps
): Promise<'back' | 'exit'> {
  for (;;) {
    const entry = (await deps.list({ global: options.global })).find(
      (candidate) => candidate.name === identity
    );
    if (!entry) {
      // 技能已不在 Store 中（例如刚被卸载）：回第一级刷新。
      return 'back';
    }
    const manifest = await deps.loadManifest(storeRootFor(options));
    printSkillDetail(entry, manifest);

    const action = await deps.selectPrompt({
      message: `${entry.name} — choose an action`,
      choices: [
        ...detailActionChoices(entry),
        { name: 'Back to list', value: ACTION_BACK },
        { name: 'Exit', value: ACTION_EXIT }
      ]
    });
    if (action === ACTION_BACK) {
      return 'back';
    }
    if (action === ACTION_EXIT) {
      return 'exit';
    }
    if (action === ACTION_UPDATE) {
      // update 成功后留在详情并刷新；取消也不离开。
      await runDetailUpdate(entry, options, deps);
      continue;
    }
    if (action === ACTION_TOOLS) {
      await runDetailTools(entry, options, deps);
      continue;
    }
    if (action === ACTION_UNLINK) {
      const done = await runDetailUnlink(entry, options, deps);
      if (done) {
        return 'back';
      }
      continue;
    }
    if (action === ACTION_UNINSTALL) {
      const done = await runDetailUninstall(entry, options, deps);
      if (done) {
        return 'back';
      }
      continue;
    }
  }
}
