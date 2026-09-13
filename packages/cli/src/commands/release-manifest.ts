import fs from 'node:fs/promises';
import path from 'node:path';
import { createMinimalReleaseManifest, validateSkillMd } from '@esl/core';
import { notify } from '../output.js';

export interface ManifestOptions {
  license?: string;
}

export const DEFAULT_LICENSE = 'MIT';

// v3 清单必须有 name（ADR-0032）。补缺场景下身份尚未与服务器确认，
// 以 SKILL.md 的 short name 写裸名——即个人命名空间语义。
async function deriveSkillName(directory: string): Promise<string> {
  const skillMd = await fs
    .readFile(path.join(directory, 'SKILL.md'), 'utf8')
    .then(
      (content) => validateSkillMd(content),
      () => undefined
    );
  if (skillMd?.success) return skillMd.data.name;
  return path.basename(directory);
}

export async function ensureReleaseManifest(options: ManifestOptions, directory: string): Promise<void> {
  const license = options.license ?? DEFAULT_LICENSE;
  if (!options.license) {
    notify(`release.json is missing; creating it with the default license ${license} (pass --license to override).`);
  }
  const releaseJson = createMinimalReleaseManifest(await deriveSkillName(directory), license);
  await fs.writeFile(path.join(directory, 'release.json'), `${JSON.stringify(releaseJson, null, 2)}\n`, 'utf8');
}
