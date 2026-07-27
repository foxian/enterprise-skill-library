import { bumpSkillVersion, type ReleaseType } from '@esl/core';

export async function executeVersion(release: ReleaseType, options: { cwd?: string } = {}): Promise<string> {
  return bumpSkillVersion(options.cwd ?? process.cwd(), release);
}
