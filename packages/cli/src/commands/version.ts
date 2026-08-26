import { bumpSkillVersion, isBuiltinIdentity, type ReleaseType } from '@esl/core';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function executeVersion(release: ReleaseType, options: { cwd?: string } = {}): Promise<string> {
  const directory = options.cwd ?? process.cwd();
  const raw = await fs.readFile(path.join(directory, 'skill.json'), 'utf8');
  const skillJson = JSON.parse(raw) as { name?: string };
  if (skillJson.name && isBuiltinIdentity(skillJson.name)) {
    throw new Error('Built-in skills cannot be versioned; their version is pinned to the ESL CLI version');
  }
  return bumpSkillVersion(directory, release);
}
