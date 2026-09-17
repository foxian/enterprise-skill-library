import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadInstallManifest,
  removeDirectory,
  removeInstalledSkill,
  removeLockEntry,
  removeSkillDependency,
  removeToolLinks,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  SUPPORTED_TOOLS,
  type LocalStoreOptions,
  type ToolName
} from '@esl/core';
import { installTargetDir, projectSkillsDir } from './network-options.js';

export interface UninstallOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  noAdapt?: boolean;
  force?: boolean;
}

export interface UninstallResult {
  removedLinks: Array<{ identity: string; tool: ToolName; targetDir: string; status: 'removed' | 'missing' | 'conflict' }>;
  sourceRemoved: boolean;
}

export async function executeUninstall(name: string, options: UninstallOptions = {}): Promise<UninstallResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global ? storeRoot : projectRoot;
  const targetDir = options.global
    ? installTargetDir(name, options)
    : projectSkillsDir(projectRoot, name);
  const installManifest = await loadInstallManifest(storeRoot);
  if (!installManifest.skills[name]) {
    throw new Error(`Skill ${name} is not installed by ESL`);
  }

  const removedLinks = await removeToolLinks({
    storeRoot,
    identity: name,
    tools: [...SUPPORTED_TOOLS],
    level: options.global ? 'global' : 'project'
  });

  await removeDirectory(targetDir);
  await removeSkillDependency(dependencyRoot, name);
  await removeLockEntry(dependencyRoot, name);
  await removeInstalledSkill(storeRoot, name);

  const conflicts = removedLinks.filter((result) => result.status === 'conflict');
  if (conflicts.length > 0) {
    throw new Error(
      `Tool link conflict; content was not removed: ${conflicts
        .map((result) => `${result.tool} (${result.targetDir})`)
        .join(', ')}`
    );
  }

  return {
    removedLinks,
    sourceRemoved: true
  };
}

const ESL_GITIGNORE_MARKER = '# ESL managed (do not edit)';
const ESL_GITIGNORE_ENTRIES = ['.eslib/'];

export async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let content = '';

  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // .gitignore does not exist yet.
  }

  const missingEntries = ESL_GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));
  if (missingEntries.length === 0) {
    return;
  }

  if (content.includes(ESL_GITIGNORE_MARKER)) {
    await fs.writeFile(
      gitignorePath,
      `${content.trimEnd()}\n${missingEntries.join('\n')}\n`,
      'utf8'
    );
    return;
  }

  const newBlock = `\n${ESL_GITIGNORE_MARKER}\n${missingEntries.join('\n')}\n`;
  await fs.writeFile(gitignorePath, content.trimEnd() + newBlock, 'utf8');
}
