import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName } from '../schema/skill-json.js';
import { loadConfig, resolveLocalStorePaths, type LocalStoreOptions } from '../store/local-store.js';
import { loadSkillsJson } from '../store/skills-json.js';
import { removeDirectory } from '../store/file-copy.js';
import { getAdapter } from './index.js';

export interface AdaptResult {
  tool: string;
  skills: AdaptedSkillResult[];
  adopted: AdaptedSkillResult[];
  pruned: AdaptedSkillTargetResult[];
  skipped: AdaptedSkillTargetResult[];
  conflicts: AdaptedSkillTargetResult[];
}

export interface AdaptedSkillResult {
  identity: string;
  directoryName: string;
}

export interface AdaptedSkillTargetResult extends AdaptedSkillResult {
  targetDir: string;
}

export interface AdaptManifest {
  version: 1;
  outputs: AdaptManifestOutput[];
}

export interface AdaptManifestOutput {
  tool: string;
  identity: string;
  directoryName: string;
  displayName: string;
  targetDir: string;
}

interface AdaptOptions extends LocalStoreOptions {
  prune?: boolean;
}

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

const ADAPT_MANIFEST = '.esl-adapt-manifest.json';

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

async function loadAdaptManifest(storeRoot: string): Promise<AdaptManifest> {
  try {
    return JSON.parse(await fs.readFile(path.join(storeRoot, ADAPT_MANIFEST), 'utf8')) as AdaptManifest;
  } catch {
    return { version: 1, outputs: [] };
  }
}

async function saveAdaptManifest(storeRoot: string, manifest: AdaptManifest): Promise<void> {
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.writeFile(path.join(storeRoot, ADAPT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function outputKey(output: Pick<AdaptManifestOutput, 'tool' | 'targetDir'>): string {
  return `${output.tool}\n${path.resolve(output.targetDir)}`;
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function targetMatchesIdentity(targetDir: string, identity: string, displayName: string): Promise<boolean> {
  if (!await directoryExists(targetDir)) {
    return false;
  }

  try {
    const skillJson = JSON.parse(await fs.readFile(path.join(targetDir, 'skill.json'), 'utf8')) as { name?: string };
    if (skillJson.name === identity) {
      return true;
    }
  } catch {
    // Fall back to SKILL.md frontmatter.
  }

  try {
    const skillMd = await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf8');
    return new RegExp(`^name:\\s*${escapeRegExp(displayName)}\\s*$`, 'm').test(skillMd);
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toResult(skill: Pick<AdaptManifestOutput, 'identity' | 'directoryName'>): AdaptedSkillResult {
  return { identity: skill.identity, directoryName: skill.directoryName };
}

function toTargetResult(output: Pick<AdaptManifestOutput, 'identity' | 'directoryName' | 'targetDir'>): AdaptedSkillTargetResult {
  return { identity: output.identity, directoryName: output.directoryName, targetDir: output.targetDir };
}

async function adaptSkillsToTools(
  tools: string[],
  skills: SkillDirectory[],
  manifest: AdaptManifest,
  manifestRoot: string,
  options: AdaptOptions,
  targetBaseForTool: (toolName: string) => string
): Promise<AdaptResult[]> {
  const existingOutputs = new Map(manifest.outputs.map((output) => [outputKey(output), output]));
  const nextOutputs = new Map(existingOutputs);
  const currentKeys = new Set<string>();
  const results: AdaptResult[] = [];
  const resultByTool = new Map<string, AdaptResult>();

  for (const toolName of tools) {
    const adapter = getAdapter(toolName);
    const targetBase = targetBaseForTool(toolName);
    const result: AdaptResult = { tool: toolName, skills: [], adopted: [], pruned: [], skipped: [], conflicts: [] };
    resultByTool.set(toolName, result);

    for (const skill of skills) {
      const targetDir = path.join(targetBase, skill.directoryName);
      const manifestOutput: AdaptManifestOutput = {
        tool: toolName,
        identity: skill.identity,
        directoryName: skill.directoryName,
        displayName: skill.displayName,
        targetDir
      };
      const key = outputKey(manifestOutput);
      currentKeys.add(key);

      if (!existingOutputs.has(key) && await directoryExists(targetDir)) {
        if (!await targetMatchesIdentity(targetDir, skill.identity, skill.displayName)) {
          result.conflicts.push(toTargetResult(manifestOutput));
          continue;
        }
        result.adopted.push(toResult(skill));
      }

      await adapter.adapt(skill.path, skill, targetBase);
      result.skills.push(toResult(skill));
      nextOutputs.set(key, manifestOutput);
    }

    results.push(result);
  }

  if (options.prune) {
    for (const output of manifest.outputs) {
      const key = outputKey(output);
      if (currentKeys.has(key)) {
        continue;
      }

      let result = resultByTool.get(output.tool);
      if (!result) {
        result = { tool: output.tool, skills: [], adopted: [], pruned: [], skipped: [], conflicts: [] };
        resultByTool.set(output.tool, result);
        results.push(result);
      }

      if (await targetMatchesIdentity(output.targetDir, output.identity, output.displayName)) {
        await removeDirectory(output.targetDir);
        nextOutputs.delete(key);
        result.pruned.push(toTargetResult(output));
      } else if (await directoryExists(output.targetDir)) {
        result.skipped.push(toTargetResult(output));
      } else {
        nextOutputs.delete(key);
      }
    }
  }

  await saveAdaptManifest(manifestRoot, { version: 1, outputs: Array.from(nextOutputs.values()) });
  return results;
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
  const manifestRoot = path.join(projectRoot, '.skills');
  return adaptSkillsToTools(
    tools,
    skills,
    await loadAdaptManifest(manifestRoot),
    manifestRoot,
    options,
    (toolName) => getAdapter(toolName).projectDir(projectRoot)
  );
}

export async function adaptGlobal(options: AdaptOptions = {}): Promise<AdaptResult[]> {
  const config = await loadConfig(options);
  if (config.tools.length === 0) {
    throw new Error('No tools configured. Run: esl config set tools claude,codex');
  }

  const paths = resolveLocalStorePaths(options);
  const skills = await scanSkillsDir(paths.skillsDir);
  return adaptSkillsToTools(
    config.tools,
    skills,
    await loadAdaptManifest(paths.root),
    paths.root,
    options,
    (toolName) => getAdapter(toolName).globalDir(options.homeDir)
  );
}
