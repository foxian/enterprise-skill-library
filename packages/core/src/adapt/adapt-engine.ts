import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName } from '../schema/skill-json.js';
import { loadConfig, resolveLocalStorePaths, type LocalStoreOptions } from '../store/local-store.js';
import { loadSkillsJson } from '../store/skills-json.js';
import { getAdapter } from './index.js';

export interface AdaptResult {
  tool: string;
  skills: AdaptedSkillResult[];
}

export interface AdaptedSkillResult {
  identity: string;
  directoryName: string;
}

interface AdaptOptions extends LocalStoreOptions {}

interface SkillDirectory {
  identity: string;
  directoryName: string;
  displayName: string;
  path: string;
}

export function adaptedSkillDirectoryName(identity: string): string {
  const { scope, skillName } = parseSkillName(identity);
  return `${scope}_${skillName}`;
}

export function adaptedSkillDisplayName(identity: string): string {
  const { scope, skillName } = parseSkillName(identity);
  return `${scope}:${skillName}`;
}

async function resolveToolList(projectRoot: string, options: AdaptOptions): Promise<string[]> {
  const projectSkillsJson = await loadSkillsJson(projectRoot);
  if (projectSkillsJson.tools && projectSkillsJson.tools.length > 0) {
    return projectSkillsJson.tools;
  }

  const config = await loadConfig(options);
  return config.tools;
}

async function scanSkillsDir(skillsDir: string): Promise<SkillDirectory[]> {
  const skills: SkillDirectory[] = [];

  let scopes;
  try {
    scopes = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const scope of scopes) {
    if (!scope.isDirectory() || !scope.name.startsWith('@')) {
      continue;
    }

    const scopePath = path.join(skillsDir, scope.name);
    const entries = await fs.readdir(scopePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const identity = `${scope.name}/${entry.name}`;
        parseSkillName(identity);
        skills.push({
          identity,
          directoryName: adaptedSkillDirectoryName(identity),
          displayName: adaptedSkillDisplayName(identity),
          path: path.join(scopePath, entry.name)
        });
      }
    }
  }

  return skills;
}

export async function adaptProject(
  projectRoot: string,
  options: AdaptOptions = {}
): Promise<AdaptResult[]> {
  const tools = await resolveToolList(projectRoot, options);
  if (tools.length === 0) {
    throw new Error('No tools configured. Run: esl config set tools claude,codex');
  }

  const skills = await scanSkillsDir(path.join(projectRoot, '.skills'));
  const results: AdaptResult[] = [];

  for (const toolName of tools) {
    const adapter = getAdapter(toolName);
    const targetBase = adapter.projectDir(projectRoot);
    await adapter.clean(targetBase);

    const adaptedSkills: AdaptedSkillResult[] = [];
    for (const skill of skills) {
      await adapter.adapt(skill.path, skill, targetBase);
      adaptedSkills.push({ identity: skill.identity, directoryName: skill.directoryName });
    }
    results.push({ tool: toolName, skills: adaptedSkills });
  }

  return results;
}

export async function adaptGlobal(options: AdaptOptions = {}): Promise<AdaptResult[]> {
  const config = await loadConfig(options);
  if (config.tools.length === 0) {
    throw new Error('No tools configured. Run: esl config set tools claude,codex');
  }

  const paths = resolveLocalStorePaths(options);
  const skills = await scanSkillsDir(paths.skillsDir);
  const results: AdaptResult[] = [];

  for (const toolName of config.tools) {
    const adapter = getAdapter(toolName);
    const targetBase = adapter.globalDir(options.homeDir);
    await adapter.clean(targetBase);

    const adaptedSkills: AdaptedSkillResult[] = [];
    for (const skill of skills) {
      await adapter.adapt(skill.path, skill, targetBase);
      adaptedSkills.push({ identity: skill.identity, directoryName: skill.directoryName });
    }
    results.push({ tool: toolName, skills: adaptedSkills });
  }

  return results;
}
