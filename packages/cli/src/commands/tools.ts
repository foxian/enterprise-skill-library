import { checkbox } from '@inquirer/prompts';
import { loadConfigOrEphemeral } from './install-interaction.js';
import {
  parseToolSelection,
  resolveToolName,
  saveConfig,
  SUPPORTED_TOOLS,
  toolDisplayName,
  type LocalStoreOptions,
  type ToolName
} from '@esl/core';

export interface ToolsPreferredOptions extends LocalStoreOptions {
  add?: string;
  remove?: string;
  interactive?: boolean;
  selectTools?: typeof checkbox;
}

export interface ToolsPreferredResult {
  tools: ToolName[];
  changed: boolean;
}

function sortByToolOrder(tools: Iterable<ToolName>): ToolName[] {
  const order = new Map(SUPPORTED_TOOLS.map((tool, index) => [tool, index]));
  return [...tools].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * View or edit the local preferred tools (ADR-0054): machine-local only, never
 * project-side, never synced to the server. `--add` / `--remove` change the
 * set incrementally; interactively a checkbox edits the whole set and allows
 * clearing it. Listing and editing never count toward tool usage stats.
 *
 * Exposed as `esl config preferred-tools`; it only affects the TTY preselection
 * for the first tool mount and never changes non-interactive install/link
 * behavior (ADR-0059).
 */
export async function executeToolsPreferred(
  options: ToolsPreferredOptions = {}
): Promise<ToolsPreferredResult> {
  const config = await loadConfigOrEphemeral({ homeDir: options.homeDir });
  const current = new Set(
    config.tools.map((tool) => {
      const resolved = resolveToolName(tool);
      if (resolved === undefined) {
        throw new Error(`Unknown configured tool: ${tool}. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`);
      }
      return resolved;
    })
  );

  if (options.add === undefined && options.remove === undefined) {
    if (options.interactive) {
      const selected = await (options.selectTools ?? checkbox)<ToolName>({
        message: 'Select your preferred AI tools (used to preselect your first tool mount)',
        choices: SUPPORTED_TOOLS.map((tool) => ({
          name: toolDisplayName(tool),
          value: tool,
          checked: current.has(tool)
        })),
        required: false
      });
      await saveConfig({ tools: [...selected] }, { homeDir: options.homeDir });
      return { tools: sortByToolOrder(selected), changed: true };
    }
    return { tools: sortByToolOrder(current), changed: false };
  }

  if (options.add !== undefined) {
    for (const tool of parseToolSelection(options.add)) {
      current.add(tool);
    }
  }
  if (options.remove !== undefined) {
    for (const tool of parseToolSelection(options.remove)) {
      current.delete(tool);
    }
  }
  await saveConfig({ tools: [...current] }, { homeDir: options.homeDir });
  return { tools: sortByToolOrder(current), changed: true };
}

export function parseToolsOption(value: string | undefined): ToolName[] {
  if (value === undefined) {
    return [];
  }
  const tools = parseToolSelection(value);
  if (tools.length === 0) {
    throw new Error('--tools requires at least one tool name');
  }
  return tools;
}
