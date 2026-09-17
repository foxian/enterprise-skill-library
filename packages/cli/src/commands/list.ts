import { listSkills, resolveLocalStorePaths, resolveProjectStorePaths, type LocalStoreOptions, type SkillListEntry } from '@esl/core';

export interface ListOptions extends LocalStoreOptions {
  global?: boolean;
  json?: boolean;
}

export async function executeList(options: ListOptions = {}): Promise<SkillListEntry[]> {
  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(process.cwd()).root;

  return listSkills(storeRoot);
}
