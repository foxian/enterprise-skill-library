import {
  listSkills,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  toolDisplayName,
  type LocalStoreOptions,
  type SkillListEntry
} from '@esl/core';

export interface ListOptions extends LocalStoreOptions {
  global?: boolean;
  json?: boolean;
}

export async function executeList(options: ListOptions = {}): Promise<SkillListEntry[]> {
  const projectRoot = process.cwd();
  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;

  return listSkills(storeRoot, {
    level: options.global ? 'global' : 'project',
    projectRoot,
    homeDir: options.homeDir
  });
}

// 只读人类输出的行级工具摘要（ADR-0055）：没有详情页可点，挂载情况要一眼可见。
export function skillToolSummary(entry: SkillListEntry): string {
  if (!entry.tools || entry.tools.length === 0) {
    return 'no tool links';
  }
  return entry.tools
    .map((link) => {
      const label = toolDisplayName(link.tool);
      return link.status === 'linked' ? label : `${label} (${link.status})`;
    })
    .join(', ');
}

export function formatSkillListLine(entry: SkillListEntry): string {
  const title =
    entry.displayName && entry.displayName !== entry.name
      ? `${entry.name} — ${entry.displayName}`
      : entry.name;
  return `  ${title.padEnd(40)} v${entry.version.padEnd(8)} (${entry.source})  tools: ${skillToolSummary(entry)}`;
}
