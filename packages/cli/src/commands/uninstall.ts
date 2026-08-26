import fs from 'node:fs/promises';
import path from 'node:path';
import { adaptProject, removeDirectory, removeSkillDependency, type LocalStoreOptions } from '@esl/core';
import { projectSkillsDir } from './network-options.js';

export interface UninstallOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  noAdapt?: boolean;
}

export async function executeUninstall(name: string, options: UninstallOptions = {}): Promise<void> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const targetDir = projectSkillsDir(projectRoot, name);

  await removeDirectory(targetDir);
  await removeSkillDependency(projectRoot, name);

  if (!options.noAdapt) {
    await adaptProject(projectRoot, { homeDir: options.homeDir, prune: true });
  }
}

const ESL_GITIGNORE_MARKER = '# ESL managed (do not edit)';
const ESL_GITIGNORE_ENTRIES = ['.skills/', '.claude/skills/', '.agents/skills/', '.trae/skills/'];

export async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let content = '';

  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // .gitignore does not exist yet.
  }

  if (content.includes(ESL_GITIGNORE_MARKER)) {
    return;
  }

  const missingEntries = ESL_GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));
  if (missingEntries.length === 0) {
    return;
  }

  const newBlock = `\n${ESL_GITIGNORE_MARKER}\n${missingEntries.join('\n')}\n`;
  await fs.writeFile(gitignorePath, content.trimEnd() + newBlock, 'utf8');
}
