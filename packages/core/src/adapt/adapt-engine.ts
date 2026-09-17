import {
  loadConfig,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  type LocalStoreOptions
} from '../store/local-store.js';
import { loadSkillsJson } from '../store/skills-json.js';
import {
  isSupportedTool,
  SUPPORTED_TOOLS,
  syncToolLinks,
  type ToolLinkOperationResult,
  type ToolName
} from '../link/tool-links.js';

export interface AdaptResult {
  tool: string;
  skills: AdaptedSkillResult[];
  adopted: AdaptedSkillResult[];
  skipped: AdaptedSkillTargetResult[];
  conflicts: AdaptedSkillTargetResult[];
  failed: AdaptedSkillTargetResult[];
}

export interface AdaptedSkillResult {
  identity: string;
  directoryName: string;
}

export interface AdaptedSkillTargetResult extends AdaptedSkillResult {
  targetDir: string;
}

interface AdaptOptions extends LocalStoreOptions {
  tools?: ToolName[];
  force?: boolean;
}

function directoryName(identity: string): string {
  const [, scope, skillName] = identity.split('/');
  return `${scope}_${skillName}`;
}

function toSkill(identity: string): AdaptedSkillResult {
  return { identity, directoryName: directoryName(identity) };
}

function toTarget(result: ToolLinkOperationResult): AdaptedSkillTargetResult {
  return { ...toSkill(result.identity), targetDir: result.targetDir };
}

function groupResults(results: ToolLinkOperationResult[]): AdaptResult[] {
  const byTool = new Map<string, AdaptResult>();
  for (const result of results) {
    let entry = byTool.get(result.tool);
    if (!entry) {
      entry = {
        tool: result.tool,
        skills: [],
        adopted: [],
        skipped: [],
        conflicts: [],
        failed: []
      };
      byTool.set(result.tool, entry);
    }
    entry.skills.push(toSkill(result.identity));
    if (result.status === 'created') {
      entry.adopted.push(toTarget(result));
    } else if (result.status === 'existing') {
      entry.skipped.push(toTarget(result));
    } else if (result.status === 'conflict') {
      entry.conflicts.push(toTarget(result));
    } else if (result.status === 'failed') {
      entry.failed.push(toTarget(result));
    }
  }
  return Array.from(byTool.values());
}

async function resolveProjectTools(projectRoot: string, options: AdaptOptions): Promise<ToolName[]> {
  if (options.tools && options.tools.length > 0) {
    return options.tools;
  }
  const skillsJson = await loadSkillsJson(projectRoot);
  if (skillsJson.tools && skillsJson.tools.length > 0) {
    return toConfiguredTools(skillsJson.tools);
  }
  const config = await loadConfig(options);
  return toConfiguredTools(config.tools);
}

async function resolveGlobalTools(options: AdaptOptions): Promise<ToolName[]> {
  if (options.tools && options.tools.length > 0) {
    return options.tools;
  }
  const config = await loadConfig(options);
  return toConfiguredTools(config.tools);
}

function toConfiguredTools(tools: string[]): ToolName[] {
  return tools.map((tool) => {
    if (!isSupportedTool(tool)) {
      throw new Error(`Unknown tool: ${tool}. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`);
    }
    return tool;
  });
}

export async function adaptProject(projectRoot: string, options: AdaptOptions = {}): Promise<AdaptResult[]> {
  const tools = await resolveProjectTools(projectRoot, options);
  if (tools.length === 0) {
    throw new Error('No tools configured. Run: esl install --tools <tools>');
  }
  const results = await syncToolLinks({
    storeRoot: resolveProjectStorePaths(projectRoot).root,
    level: 'project',
    tools,
    projectRoot,
    homeDir: options.homeDir,
    force: options.force
  });
  return groupResults(results);
}

export async function adaptGlobal(options: AdaptOptions = {}): Promise<AdaptResult[]> {
  const tools = await resolveGlobalTools(options);
  if (tools.length === 0) {
    throw new Error('No tools configured. Run: esl install --tools <tools>');
  }
  const results = await syncToolLinks({
    storeRoot: resolveLocalStorePaths(options).root,
    level: 'global',
    tools,
    homeDir: options.homeDir,
    force: options.force
  });
  return groupResults(results);
}
