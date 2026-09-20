import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  loadInstallManifest,
  skillDirectoryName,
  skillSourceRelativeDir
} from '../store/skill-store.js';

export const SUPPORTED_TOOLS = [
  'claude',
  'codex',
  'cursor',
  'trae-intl',
  'trae-cn',
  'workbuddy',
  'opencode',
  'openclaw',
  'hermes'
] as const;

export type ToolName = (typeof SUPPORTED_TOOLS)[number];
export type ToolLevel = 'project' | 'global';
export type ToolLinkStatus = 'linked' | 'broken' | 'conflict' | 'source-only' | 'unmanaged';

export interface ToolLinkRecord {
  identity: string;
  tool: ToolName;
  level: ToolLevel;
  sourceDir: string;
  targetDir: string;
  createdAt: string;
}

export interface ToolLinkManifest {
  version: 1;
  links: ToolLinkRecord[];
}

export interface ToolLinkEntry {
  tool: ToolName | 'source';
  identity: string;
  level: ToolLevel;
  status: ToolLinkStatus;
  managed: boolean;
  sourceDir: string;
  targetDir?: string;
}

export interface CreateToolLinkOptions {
  identity: string;
  tool: ToolName;
  level: ToolLevel;
  storeRoot: string;
  projectRoot?: string;
  homeDir?: string;
  force?: boolean;
}

export interface ToolLinkOperationResult {
  identity: string;
  tool: ToolName;
  targetDir: string;
  status: 'created' | 'existing' | 'conflict' | 'failed';
  error?: string;
}

const TOOL_LINK_MANIFEST_FILE = '.esl-tools-manifest.json';

export function isSupportedTool(value: string): value is ToolName {
  return (SUPPORTED_TOOLS as readonly string[]).includes(value);
}

const TOOL_NAME_ALIASES: Record<string, ToolName> = {
  'claude-code': 'claude'
};

export function resolveToolName(value: string): ToolName | undefined {
  const normalized = value.trim().toLowerCase();
  return isSupportedTool(normalized) ? normalized : TOOL_NAME_ALIASES[normalized];
}

export function parseToolSelection(value: string): ToolName[] {
  const raw = value.trim().toLowerCase();
  if (raw === 'all') {
    return [...SUPPORTED_TOOLS];
  }
  const tools = value
    .split(',')
    .map((tool) => tool.trim().toLowerCase())
    .filter((tool) => tool.length > 0);
  const resolved = tools.map((tool) => resolveToolName(tool));
  for (const [index, tool] of resolved.entries()) {
    if (tool === undefined) {
      throw new Error(
        `Unknown tool: ${tools[index]}. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`
      );
    }
  }
  return resolved as ToolName[];
}

export function toolDirectory(
  tool: ToolName,
  level: ToolLevel,
  options: { projectRoot?: string; homeDir?: string } = {}
): string {
  const projectRoot = options.projectRoot ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  switch (tool) {
    case 'claude':
      return level === 'project'
        ? path.join(projectRoot, '.claude', 'skills')
        : path.join(homeDir, '.claude', 'skills');
    case 'codex':
      return level === 'project'
        ? path.join(projectRoot, '.codex', 'skills')
        : path.join(homeDir, '.codex', 'skills');
    case 'cursor':
      return level === 'project'
        ? path.join(projectRoot, '.cursor', 'skills')
        : path.join(homeDir, '.cursor', 'skills');
    case 'trae-intl':
      return level === 'project'
        ? path.join(projectRoot, '.trae', 'skills')
        : path.join(homeDir, '.trae', 'skills');
    case 'trae-cn':
      return level === 'project'
        ? path.join(projectRoot, '.trae', 'skills')
        : path.join(homeDir, '.trae-cn', 'skills');
    case 'workbuddy':
      return level === 'project'
        ? path.join(projectRoot, '.workbuddy', 'skills')
        : path.join(homeDir, '.workbuddy', 'skills');
    case 'opencode':
      return level === 'project'
        ? path.join(projectRoot, '.opencode', 'skills')
        : path.join(homeDir, '.config', 'opencode', 'skills');
    case 'openclaw':
      return level === 'project'
        ? path.join(projectRoot, 'skills')
        : path.join(homeDir, '.openclaw', 'skills');
    case 'hermes':
      return level === 'project'
        ? path.join(projectRoot, '.hermes', 'skills')
        : path.join(homeDir, '.hermes', 'skills');
  }
}

export function toolLinkManifestPath(storeRoot: string): string {
  return path.join(storeRoot, TOOL_LINK_MANIFEST_FILE);
}

export function defaultToolLinkManifest(): ToolLinkManifest {
  return { version: 1, links: [] };
}

export async function loadToolLinkManifest(storeRoot: string): Promise<ToolLinkManifest> {
  try {
    const raw = await fs.readFile(toolLinkManifestPath(storeRoot), 'utf8');
    const parsed = JSON.parse(raw) as ToolLinkManifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.links)) {
      throw new Error('Invalid ESL tools manifest');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultToolLinkManifest();
    }
    throw error;
  }
}

export async function saveToolLinkManifest(storeRoot: string, manifest: ToolLinkManifest): Promise<void> {
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.writeFile(
    toolLinkManifestPath(storeRoot),
    `${JSON.stringify({ version: 1, links: manifest.links }, null, 2)}\n`,
    'utf8'
  );
}

async function lstatPath(target: string) {
  try {
    return await fs.lstat(target);
  } catch {
    return null;
  }
}

async function isLink(target: string): Promise<boolean> {
  const stat = await lstatPath(target);
  return stat?.isSymbolicLink() ?? false;
}

async function readLinkTarget(target: string): Promise<string | null> {
  try {
    return path.resolve(await fs.readlink(target));
  } catch {
    return null;
  }
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function createLink(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  if (process.platform === 'win32') {
    await fs.symlink(sourceDir, targetDir, 'junction');
  } else {
    await fs.symlink(sourceDir, targetDir, 'dir');
  }
}

function recordKey(record: Pick<ToolLinkRecord, 'identity' | 'tool' | 'level'>): string {
  return `${record.identity}\n${record.tool}\n${record.level}`;
}

export async function createToolLink(options: CreateToolLinkOptions): Promise<ToolLinkOperationResult> {
  const { identity, tool, level, storeRoot, force = false } = options;
  const sourceDir = path.resolve(storeRoot, skillSourceRelativeDir(identity));
  const targetDir = path.resolve(toolDirectory(tool, level, options), skillDirectoryName(identity));
  const manifest = await loadToolLinkManifest(storeRoot);
  const existingRecord = manifest.links.find(
    (record) => recordKey(record) === recordKey({ identity, tool, level })
  );

  const targetStat = await lstatPath(targetDir);
  if (targetStat) {
    if (targetStat.isSymbolicLink()) {
      const currentTarget = await readLinkTarget(targetDir);
      if (currentTarget === sourceDir) {
        if (existingRecord) {
          return { identity, tool, targetDir, status: 'existing' };
        }
        const managedByAnotherTool = manifest.links.some(
          (record) =>
            record.level === level &&
            targetKey(record.targetDir) === targetKey(targetDir) &&
            path.resolve(storeRoot, record.sourceDir) === sourceDir
        );
        if (managedByAnotherTool) {
          manifest.links.push({
            identity,
            tool,
            level,
            sourceDir: path.relative(storeRoot, sourceDir),
            targetDir,
            createdAt: new Date().toISOString()
          });
          await saveToolLinkManifest(storeRoot, manifest);
          return { identity, tool, targetDir, status: 'existing' };
        }
        return {
          identity,
          tool,
          targetDir,
          status: 'conflict',
          error: 'target link is unmanaged; ESL did not create it'
        };
      }

      if (force && existingRecord && path.resolve(existingRecord.targetDir) === targetDir) {
        await fs.rm(targetDir, { force: true });
      } else {
        return { identity, tool, targetDir, status: 'conflict' };
      }
    } else {
      return { identity, tool, targetDir, status: 'conflict' };
    }
  }

  if (!await directoryExists(sourceDir)) {
    return { identity, tool, targetDir, status: 'conflict' };
  }

  await createLink(sourceDir, targetDir);
  const record: ToolLinkRecord = {
    identity,
    tool,
    level,
    sourceDir: path.relative(storeRoot, sourceDir),
    targetDir,
    createdAt: new Date().toISOString()
  };
  const nextLinks = manifest.links.filter((candidate) => recordKey(candidate) !== recordKey(record));
  nextLinks.push(record);
  await saveToolLinkManifest(storeRoot, { version: 1, links: nextLinks });
  return { identity, tool, targetDir, status: 'created' };
}

export interface SyncToolLinksOptions {
  storeRoot: string;
  level: ToolLevel;
  tools: ToolName[];
  identities?: string[];
  projectRoot?: string;
  homeDir?: string;
  force?: boolean;
}

export async function syncToolLinks(options: SyncToolLinksOptions): Promise<ToolLinkOperationResult[]> {
  const manifest = await loadInstallManifest(options.storeRoot);
  const results: ToolLinkOperationResult[] = [];
  const identities = options.identities ?? Object.keys(manifest.skills);
  for (const identity of identities) {
    if (!manifest.skills[identity]) {
      continue;
    }
    for (const tool of options.tools) {
      try {
        results.push(await createToolLink({
          identity,
          tool,
          level: options.level,
          storeRoot: options.storeRoot,
          projectRoot: options.projectRoot,
          homeDir: options.homeDir,
          force: options.force
        }));
      } catch (error) {
        results.push({
          identity,
          tool,
          targetDir: path.resolve(toolDirectory(tool, options.level, options), skillDirectoryName(identity)),
          status: 'failed',
          error: (error as Error).message
        });
      }
    }
  }
  return results;
}

export interface RemoveToolLinksOptions {
  storeRoot: string;
  identity: string;
  tools: ToolName[];
  level: ToolLevel;
}

export interface RemovedToolLinkResult {
  identity: string;
  tool: ToolName;
  targetDir: string;
  status: 'removed' | 'missing' | 'conflict';
}

export async function removeToolLinks(options: RemoveToolLinksOptions): Promise<RemovedToolLinkResult[]> {
  const manifest = await loadToolLinkManifest(options.storeRoot);
  const results: RemovedToolLinkResult[] = [];
  const requestedTools = new Set(options.tools);
  const remaining: ToolLinkRecord[] = [];
  const requestedRecords = manifest.links.filter(
    (record) =>
      record.identity === options.identity &&
      record.level === options.level &&
      requestedTools.has(record.tool)
  );

  for (const record of manifest.links) {
    if (!requestedRecords.includes(record)) {
      remaining.push(record);
      continue;
    }

    const targetDir = path.resolve(record.targetDir);
    const expectedSourceDir = path.resolve(options.storeRoot, record.sourceDir);
    const sharedReference = manifest.links.some(
      (candidate) =>
        !requestedRecords.includes(candidate) &&
        candidate.level === record.level &&
        targetKey(candidate.targetDir) === targetKey(record.targetDir)
    );

    if (await isLink(targetDir)) {
      const currentTarget = await readLinkTarget(targetDir);
      if (currentTarget === expectedSourceDir) {
        if (!sharedReference) {
          await fs.rm(targetDir, { force: true });
        }
        results.push({ identity: record.identity, tool: record.tool, targetDir, status: 'removed' });
        continue;
      }
      results.push({ identity: record.identity, tool: record.tool, targetDir, status: 'conflict' });
      remaining.push(record);
      continue;
    }

    if (await directoryExists(targetDir)) {
      results.push({ identity: record.identity, tool: record.tool, targetDir, status: 'conflict' });
      remaining.push(record);
      continue;
    }

    results.push({ identity: record.identity, tool: record.tool, targetDir, status: 'missing' });
  }

  await saveToolLinkManifest(options.storeRoot, { version: 1, links: remaining });
  return results;
}

export interface ListToolLinksOptions {
  storeRoot: string;
  level: ToolLevel;
  projectRoot?: string;
  homeDir?: string;
}

export async function listToolLinks(options: ListToolLinksOptions): Promise<ToolLinkEntry[]> {
  const [installManifest, toolManifest] = await Promise.all([
    loadInstallManifest(options.storeRoot),
    loadToolLinkManifest(options.storeRoot)
  ]);
  const entries: ToolLinkEntry[] = [];
  const manifestRecords = toolManifest.links.filter((record) => record.level === options.level);
  const recordTargets = new Set(manifestRecords.map((record) => targetKey(record.targetDir)));

  for (const record of manifestRecords) {
    const targetDir = path.resolve(record.targetDir);
    const expectedSourceDir = path.resolve(options.storeRoot, record.sourceDir);
    const stat = await lstatPath(targetDir);
    let status: ToolLinkStatus;

    if (!stat) {
      status = 'broken';
    } else if (!stat.isSymbolicLink()) {
      status = 'conflict';
    } else {
      const linkTarget = await readLinkTarget(targetDir);
      if (linkTarget === expectedSourceDir && await directoryExists(expectedSourceDir)) {
        status = 'linked';
      } else if (linkTarget && !await directoryExists(linkTarget)) {
        status = 'broken';
      } else {
        status = 'conflict';
      }
    }

    entries.push({
      tool: record.tool,
      identity: record.identity,
      level: options.level,
      status,
      managed: true,
      sourceDir: expectedSourceDir,
      targetDir
    });
  }

  for (const tool of SUPPORTED_TOOLS) {
    const directory = toolDirectory(tool, options.level, options);
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      const targetDir = path.join(directory, dirent.name);
      if (recordTargets.has(targetKey(targetDir))) {
        continue;
      }
      const stat = await lstatPath(targetDir);
      entries.push({
        tool,
        identity: dirent.name,
        level: options.level,
        status: stat?.isDirectory() || stat?.isSymbolicLink() ? 'unmanaged' : 'conflict',
        managed: false,
        sourceDir: '',
        targetDir
      });
    }
  }

  const recordedIdentities = new Set(manifestRecords.map((record) => record.identity));
  for (const identity of Object.keys(installManifest.skills)) {
    if (!recordedIdentities.has(identity)) {
        entries.push({
          tool: 'source',
          identity,
          level: options.level,
          status: 'source-only',
          managed: true,
          sourceDir: path.resolve(
            options.storeRoot,
            installManifest.skills[identity].sourceDir
          )
        });
    }
  }

  return entries;
}

function targetKey(targetDir: string): string {
  const resolved = path.resolve(targetDir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
