import { listSkills, type SkillListEntry } from '@esl/core';
import { resolveLocalStorePaths, type LocalStoreOptions } from '@esl/core';

export interface ListOptions extends LocalStoreOptions {
  global?: boolean;
  json?: boolean;
}

export async function executeList(options: ListOptions = {}): Promise<SkillListEntry[]> {
  const projectRoot = options.global
    ? resolveLocalStorePaths(options).skillsDir.replace(/[/\\]skills$/, '')
    : process.cwd();

  return listSkills(projectRoot);
}
