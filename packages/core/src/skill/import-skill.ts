import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName, validateSkillJson, type SkillJson } from '../schema/skill-json.js';
import { validateSkillDirectory } from './directory-validator.js';
import { validateSkillMd } from './skill-md.js';

export interface PrepareSkillImportOptions {
  namespace?: string;
  author?: string;
}

export interface PrepareSkillImportResult {
  directory: string;
  skillName: string;
  createdSkillJson: boolean;
}

const NamespacePattern = /^[a-z0-9-]+$/;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readExistingSkillJson(skillJsonPath: string): Promise<SkillJson> {
  const raw = await fs.readFile(skillJsonPath, 'utf8');
  const validation = validateSkillJson(JSON.parse(raw));
  if (!validation.success) {
    throw new Error(validation.errors.join(', '));
  }
  return validation.data;
}

export async function prepareSkillImport(
  directory: string,
  options: PrepareSkillImportOptions = {}
): Promise<PrepareSkillImportResult> {
  const resolved = path.resolve(directory);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`${resolved} is not a directory`);
  }

  const skillMdPath = path.join(resolved, 'SKILL.md');
  const skillMdValidation = validateSkillMd(await fs.readFile(skillMdPath, 'utf8'));
  if (!skillMdValidation.success) {
    throw new Error(skillMdValidation.errors.join(', '));
  }

  const namespace = options.namespace ?? 'local';
  if (!NamespacePattern.test(namespace)) {
    throw new Error('Namespace must use lowercase letters, digits, and hyphens');
  }

  const skillName = `@${namespace}/${skillMdValidation.data.name}`;
  parseSkillName(skillName);

  const skillJsonPath = path.join(resolved, 'skill.json');
  const createdSkillJson = !(await fileExists(skillJsonPath));

  if (createdSkillJson) {
    const skillJson: SkillJson = {
      name: skillName,
      version: '0.1.0',
      description: skillMdValidation.data.description,
      author: options.author ?? process.env.USER ?? process.env.USERNAME ?? 'anonymous',
      keywords: []
    };
    await fs.writeFile(skillJsonPath, `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');
  } else {
    const existing = await readExistingSkillJson(skillJsonPath);
    if (existing.name !== skillName) {
      throw new Error(`skill.json name "${existing.name}" must match import name "${skillName}"`);
    }
  }

  const validation = await validateSkillDirectory(resolved);
  if (!validation.success) {
    throw new Error(`Invalid skill package at ${resolved}: ${validation.errors.join(', ')}`);
  }

  return {
    directory: resolved,
    skillName,
    createdSkillJson
  };
}
