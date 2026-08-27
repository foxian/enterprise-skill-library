import { bumpSkillVersion, fileExists, isBuiltinIdentity, type ReleaseType } from '@esl/core';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function executeVersion(release: ReleaseType, options: { cwd?: string } = {}): Promise<string> {
  const directory = options.cwd ?? process.cwd();
  const skillJsonPath = path.join(directory, 'skill.json');
  const releaseManifestPath = path.join(directory, 'release.json');

  if ((await fileExists(releaseManifestPath)) && !(await fileExists(skillJsonPath))) {
    throw new Error(
      'This source-form skill does not store a version; pass the version to esl publish <version> instead of esl version'
    );
  }

  const raw = await fs.readFile(skillJsonPath, 'utf8');
  const skillJson = JSON.parse(raw) as { name?: string };
  if (skillJson.name && isBuiltinIdentity(skillJson.name)) {
    throw new Error('Built-in skills cannot be versioned; their version is pinned to the ESL CLI version');
  }
  return bumpSkillVersion(directory, release);
}
