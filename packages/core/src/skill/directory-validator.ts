import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName, validateSkillJson, type SkillJson } from '../schema/skill-json.js';
import type { ValidationResult } from '../schema/validation-result.js';
import { validateSkillMd, type SkillMdMetadata } from './skill-md.js';

export interface SkillDirectory {
  directory: string;
  skillJson: SkillJson;
  skillMd: SkillMdMetadata;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function validateSkillDirectory(directory: string): Promise<ValidationResult<SkillDirectory>> {
  const errors: string[] = [];
  const skillJsonPath = path.join(directory, 'skill.json');
  const skillMdPath = path.join(directory, 'SKILL.md');

  if (!(await exists(skillJsonPath))) {
    errors.push('skill.json: file is required');
  }
  if (!(await exists(skillMdPath))) {
    errors.push('SKILL.md: file is required');
  }
  if (await exists(path.join(directory, 'resources'))) {
    errors.push('resources/: deprecated; use assets/ for runtime assets');
  }

  let skillJson: SkillJson | undefined;
  let skillMd: SkillMdMetadata | undefined;

  if (await exists(skillJsonPath)) {
    try {
      const raw = await fs.readFile(skillJsonPath, 'utf8');
      const validation = validateSkillJson(JSON.parse(raw));
      if (validation.success) {
        skillJson = validation.data;
      } else {
        errors.push(...validation.errors);
      }
    } catch (error) {
      errors.push(`skill.json: ${(error as Error).message}`);
    }
  }

  if (await exists(skillMdPath)) {
    try {
      const validation = validateSkillMd(await fs.readFile(skillMdPath, 'utf8'));
      if (validation.success) {
        skillMd = validation.data;
      } else {
        errors.push(...validation.errors);
      }
    } catch (error) {
      errors.push(`SKILL.md: ${(error as Error).message}`);
    }
  }

  if (skillJson && skillMd) {
    const { skillName } = parseSkillName(skillJson.name);
    if (skillMd.name !== skillName) {
      errors.push(`SKILL.md name must match skill.json name suffix "${skillName}"`);
    }
    const directoryName = path.basename(path.resolve(directory));
    if (skillMd.name !== directoryName) {
      errors.push(`SKILL.md name must match directory name "${directoryName}"`);
    }
  }

  if (errors.length > 0 || !skillJson || !skillMd) {
    return { success: false, errors };
  }

  return { success: true, data: { directory, skillJson, skillMd } };
}
