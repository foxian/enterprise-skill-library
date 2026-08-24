import fs from 'node:fs/promises';
import { parseSkillName } from '../schema/skill-json.js';

export async function preparePublishedSkillPackage(
  directory: string,
  identity: string
): Promise<void> {
  const { scope, skillName } = parseSkillName(identity);
  const skillMdPath = `${directory}/SKILL.md`;
  const content = await fs.readFile(skillMdPath, 'utf8');
  const updated = content.replace(
    /^(---\r?\n)([\s\S]*?)(\r?\n---)/,
    (_match, open: string, frontmatter: string, close: string) =>
      `${open}${frontmatter.replace(/(^name:\s*)[^\r\n]+/m, `$1${scope}:${skillName}`)}${close}`
  );
  await fs.writeFile(skillMdPath, updated, 'utf8');
}
