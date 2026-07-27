import fs from 'node:fs/promises';
import path from 'node:path';
import { validateSkillJson, type SkillJson } from '../schema/skill-json.js';

export type ReleaseType = 'major' | 'minor' | 'patch';

function nextVersion(current: string, release: ReleaseType): string {
  const [major, minor, patch] = current.split('.').map(Number);
  if (release === 'major') {
    return `${major + 1}.0.0`;
  }
  if (release === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export async function bumpSkillVersion(directory: string, release: ReleaseType): Promise<string> {
  const skillJsonPath = path.join(directory, 'skill.json');
  const raw = await fs.readFile(skillJsonPath, 'utf8');
  const data = JSON.parse(raw) as SkillJson;
  const validation = validateSkillJson(data);
  if (!validation.success) {
    throw new Error(`Cannot bump invalid skill.json: ${validation.errors.join(', ')}`);
  }

  const version = nextVersion(validation.data.version, release);
  await fs.writeFile(skillJsonPath, `${JSON.stringify({ ...validation.data, version }, null, 2)}\n`, 'utf8');
  return version;
}
