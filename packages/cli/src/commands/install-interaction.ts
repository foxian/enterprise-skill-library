import fs from 'node:fs/promises';
import path from 'node:path';
import { checkbox, confirm } from '@inquirer/prompts';
import {
  isBuiltinIdentity,
  loadInstallManifest,
  loadToolLinkManifest,
  resolveToolName,
  SUPPORTED_TOOLS,
  toolDisplayName,
  validateSkillMd,
  type ToolLevel,
  type ToolName
} from '@esl/core';

export interface InstallTargetState {
  installed: boolean;
  isSourceLink: boolean;
}

/**
 * Best-effort identity of the skill about to be installed, used to inspect the
 * store before anything is written. Server and builtin installs install under
 * the given name; local paths are resolved from their manifest or SKILL.md.
 */
export async function resolveInstallIdentityHint(nameOrPath: string): Promise<string> {
  if (isBuiltinIdentity(nameOrPath)) {
    return nameOrPath;
  }
  const isLocalPath =
    nameOrPath.startsWith('.') ||
    nameOrPath.startsWith('/') ||
    nameOrPath.startsWith('\\') ||
    path.isAbsolute(nameOrPath);
  if (!isLocalPath) {
    return nameOrPath;
  }

  const resolved = path.resolve(nameOrPath);
  try {
    const skillJson = JSON.parse(await fs.readFile(path.join(resolved, 'skill.json'), 'utf8')) as {
      name?: string;
    };
    if (typeof skillJson.name === 'string' && skillJson.name.length > 0) {
      return skillJson.name;
    }
  } catch {
    // Fall through to SKILL.md.
  }
  try {
    const skillMd = validateSkillMd(await fs.readFile(path.join(resolved, 'SKILL.md'), 'utf8'));
    if (skillMd.success) {
      return `@local/${skillMd.data.name}`;
    }
  } catch {
    // No readable source; the install itself will report the real problem.
  }
  return nameOrPath;
}

export async function inspectInstallTarget(
  storeRoot: string,
  identity: string
): Promise<InstallTargetState> {
  const manifest = await loadInstallManifest(storeRoot);
  const entry = manifest.skills[identity];
  return { installed: Boolean(entry), isSourceLink: entry?.source === 'link' };
}

export async function loadExistingManagedTools(
  storeRoot: string,
  identity: string,
  level: ToolLevel
): Promise<ToolName[]> {
  const manifest = await loadToolLinkManifest(storeRoot);
  const tools = new Set<ToolName>();
  for (const record of manifest.links) {
    if (record.identity === identity && record.level === level) {
      tools.add(record.tool);
    }
  }
  return [...tools];
}

export interface ExpectedToolsPromptOptions {
  identity: string;
  existing: ToolName[];
  preferred: ToolName[];
  selectTools?: typeof checkbox;
}

/** Normalize the local preferred tools (`config.tools`) into canonical ids. */
export function resolvePreferredTools(tools: string[]): ToolName[] {
  return tools.map((tool) => {
    const resolved = resolveToolName(tool);
    if (resolved === undefined) {
      throw new Error(`Unknown configured tool: ${tool}. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`);
    }
    return resolved;
  });
}

/**
 * Every interactive install/link prompts this checkbox. Existing ESL-managed
 * links are preselected; on the first tool mount (no managed links yet) the
 * local preferred tools are preselected and announced as such. The submitted
 * selection is the Expected Tool Link Set for the skill (ADR-0054).
 */
export async function promptExpectedTools(options: ExpectedToolsPromptOptions): Promise<ToolName[]> {
  const firstMount = options.existing.length === 0;
  const preselected = firstMount ? options.preferred : options.existing;
  const message = firstMount
    ? `First tool mount for ${options.identity}: the preselected tools are your preferred tools, not existing links. Select AI tools`
    : `Select AI tools for ${options.identity}`;
  const selected = await (options.selectTools ?? checkbox)<ToolName>({
    message,
    choices: SUPPORTED_TOOLS.map((tool) => ({
      name: toolDisplayName(tool),
      value: tool,
      checked: preselected.includes(tool)
    })),
    required: true
  });
  if (selected.length === 0) {
    throw new Error(
      `No tools selected; to remove all ESL-managed tool links for ${options.identity}, use: esl tools remove ${options.identity}`
    );
  }
  return selected;
}

export async function confirmOverwriteInstall(
  identity: string,
  confirmPrompt: typeof confirm = confirm
): Promise<boolean> {
  return confirmPrompt({
    message: `${identity} is already installed. Installing again will overwrite the existing copy. Continue?`,
    default: false
  });
}

export async function confirmSourceLinkToInstall(
  identity: string,
  confirmPrompt: typeof confirm = confirm
): Promise<boolean> {
  return confirmPrompt({
    message: `${identity} is currently a Skill Source Link (dev mode). Installing will replace it with a regular installed copy. Continue?`,
    default: false
  });
}

export async function confirmInstallToSourceLink(
  identity: string,
  confirmPrompt: typeof confirm = confirm
): Promise<boolean> {
  return confirmPrompt({
    message: `${identity} is currently a regular installed copy. Linking will replace it with a Skill Source Link (dev mode); the copy moves into Link Staging. Continue?`,
    default: false
  });
}
