import { adaptGlobal, adaptProject, type AdaptResult } from '@esl/core';

export interface AdaptCommandOptions {
  global?: boolean;
  directory?: string;
}

export async function executeAdapt(options: AdaptCommandOptions = {}): Promise<AdaptResult[]> {
  if (options.global) {
    return adaptGlobal();
  }

  const projectRoot = options.directory ?? process.cwd();
  return adaptProject(projectRoot);
}

export function formatAdaptResults(results: AdaptResult[]): string[] {
  return results.map((result) => {
    const mappings = result.skills.map((skill) => `${skill.identity} -> ${skill.directoryName}`).join(', ');
    return `${result.tool}: ${result.skills.length} skill(s) synced${mappings ? ` (${mappings})` : ''}`;
  });
}
