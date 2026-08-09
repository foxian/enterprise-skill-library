import path from 'node:path';
import { prepareSkillImport } from '@esl/core';
import { executeInstall } from './install.js';

export interface ImportOptions {
  namespace?: string;
  noAdapt?: boolean;
  projectRoot?: string;
  homeDir?: string;
  author?: string;
}

export interface ImportResult {
  skillName: string;
  sourceDir: string;
  targetDir: string;
  createdSkillJson: boolean;
}

export async function executeImport(sourcePath: string, options: ImportOptions = {}): Promise<ImportResult> {
  const sourceDir = path.resolve(sourcePath);
  const prepared = await prepareSkillImport(sourceDir, {
    namespace: options.namespace,
    author: options.author
  });
  const targetDir = await executeInstall(prepared.directory, {
    projectRoot: options.projectRoot,
    homeDir: options.homeDir,
    noAdapt: options.noAdapt
  });

  return {
    skillName: prepared.skillName,
    sourceDir: prepared.directory,
    targetDir,
    createdSkillJson: prepared.createdSkillJson
  };
}
