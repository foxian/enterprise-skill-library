export type { ToolAdapter } from './tool-adapter.js';
export { adaptGlobal, adaptProject, type AdaptResult } from './adapt-engine.js';
export { ClaudeAdapter } from './claude-adapter.js';
export { CodexAdapter } from './codex-adapter.js';
export { TraeAdapter } from './trae-adapter.js';
export { TraeCnAdapter } from './trae-cn-adapter.js';

import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { TraeAdapter } from './trae-adapter.js';
import { TraeCnAdapter } from './trae-cn-adapter.js';
import type { ToolAdapter } from './tool-adapter.js';

export const SUPPORTED_TOOLS = ['claude', 'codex', 'trae', 'trae-cn'];

const adapters: Record<string, () => ToolAdapter> = {
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
  trae: () => new TraeAdapter(),
  'trae-cn': () => new TraeCnAdapter()
};

export function getAdapter(name: string): ToolAdapter {
  const factory = adapters[name];
  if (!factory) {
    throw new Error(`Unknown tool: ${name}. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`);
  }
  return factory();
}
