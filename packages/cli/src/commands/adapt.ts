import { adaptGlobal, adaptProject, type AdaptResult } from '@esl/core';

export interface AdaptCommandOptions {
  global?: boolean;
  directory?: string;
  prune?: boolean;
}

export async function executeAdapt(options: AdaptCommandOptions = {}): Promise<AdaptResult[]> {
  if (options.global) {
    return adaptGlobal({ prune: options.prune });
  }

  const projectRoot = options.directory ?? process.cwd();
  return adaptProject(projectRoot, { prune: options.prune });
}

export function formatAdaptResults(results: AdaptResult[]): string[] {
  return results.map((result) => {
    const mappings = result.skills.map((skill) => `${skill.identity} -> ${skill.directoryName}`).join(', ');
    const details = [
      mappings,
      formatOutcome('adopted', result.adopted),
      formatOutcome('pruned', result.pruned),
      formatOutcome('skipped', result.skipped),
      formatOutcome('conflicts', result.conflicts)
    ].filter(Boolean).join('; ');
    return `${result.tool}: ${result.skills.length} skill(s) synced${details ? ` (${details})` : ''}`;
  });
}

function formatOutcome(label: string, skills: Array<{ identity: string; directoryName: string }>): string {
  if (skills.length === 0) {
    return '';
  }
  return `${label}: ${skills.map((skill) => `${skill.identity} -> ${skill.directoryName}`).join(', ')}`;
}
