import {
  listToolLinks,
  parseToolSelection,
  removeToolLinks,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  SUPPORTED_TOOLS,
  type LocalStoreOptions,
  type RemovedToolLinkResult,
  type ToolLinkEntry,
  type ToolName
} from '@esl/core';

export interface ToolsListOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  tool?: string;
  skill?: string;
  managed?: boolean;
  unmanaged?: boolean;
  status?: string;
}

export interface ToolsRemoveOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  tools: ToolName[];
}

function storeRootFor(options: { projectRoot?: string; global?: boolean } & LocalStoreOptions): string {
  if (options.global) {
    return resolveLocalStorePaths(options).root;
  }
  return resolveProjectStorePaths(options.projectRoot ?? process.cwd()).root;
}

function parseCommaList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function executeToolsList(options: ToolsListOptions = {}): Promise<ToolLinkEntry[]> {
  const storeRoot = storeRootFor(options);
  const entries = await listToolLinks({
    storeRoot,
    level: options.global ? 'global' : 'project',
    projectRoot: options.projectRoot ?? process.cwd(),
    homeDir: options.homeDir
  });

  const tools = parseCommaList(options.tool).map((tool) => tool.toLowerCase());
  const skills = parseCommaList(options.skill).map((skill) => skill.toLowerCase());
  const statuses = parseCommaList(options.status).map((status) => status.toLowerCase());

  return entries.filter((entry) => {
    if (tools.length > 0 && !tools.includes(entry.tool)) {
      return false;
    }
    if (skills.length > 0 && !skills.includes(entry.identity.toLowerCase())) {
      return false;
    }
    if (options.managed === true && !entry.managed) {
      return false;
    }
    if (options.unmanaged === true && entry.managed) {
      return false;
    }
    if (statuses.length > 0 && !statuses.includes(entry.status)) {
      return false;
    }
    return true;
  });
}

export async function executeToolsRemove(
  skillName: string,
  options: ToolsRemoveOptions
): Promise<RemovedToolLinkResult[]> {
  if (options.tools.length === 0) {
    throw new Error(`No tools selected. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`);
  }

  const storeRoot = storeRootFor(options);
  return removeToolLinks({
    storeRoot,
    identity: skillName,
    tools: options.tools,
    level: options.global ? 'global' : 'project'
  });
}

export function parseToolsOption(value: string | undefined): ToolName[] {
  if (!value) {
    return [];
  }
  return parseToolSelection(value);
}

export function formatToolsList(entries: ToolLinkEntry[]): string[] {
  if (entries.length === 0) {
    return ['No matching skill links.'];
  }

  return entries.map((entry) => {
    const target = entry.targetDir ? ` -> ${entry.targetDir}` : '';
    return `${entry.tool.padEnd(10)} ${entry.identity.padEnd(32)} ${entry.level.padEnd(7)} ${entry.status.padEnd(11)} ${entry.managed ? 'managed' : 'unmanaged'}${target}`;
  });
}
