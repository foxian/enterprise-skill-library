import fs from 'node:fs/promises';
import path from 'node:path';
import { copySkillDirectory } from '../store/file-copy.js';
import type { AdaptedSkill } from './tool-adapter.js';

export async function copyAdaptedSkill(skillSourceDir: string, skill: AdaptedSkill, targetBaseDir: string): Promise<void> {
  const targetDir = path.join(targetBaseDir, skill.directoryName);
  await copySkillDirectory(skillSourceDir, targetDir);
  await rewriteSkillMdName(path.join(targetDir, 'SKILL.md'), skill.displayName);
}

async function rewriteSkillMdName(skillMdPath: string, displayName: string): Promise<void> {
  const content = await fs.readFile(skillMdPath, 'utf8');
  const updated = content.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, open, frontmatter, close) => {
    return `${open}${frontmatter.replace(/(^name:\s*)[^\r\n]+/m, `$1${displayName}`)}${close}`;
  });
  await fs.chmod(skillMdPath, 0o666);
  await fs.writeFile(skillMdPath, updated, 'utf8');
  await fs.chmod(skillMdPath, 0o444);
}
