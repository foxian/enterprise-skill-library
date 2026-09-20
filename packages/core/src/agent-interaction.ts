import { randomUUID } from 'node:crypto';
import type { ToolName } from './link/tool-links.js';

export const AGENT_INTERACTION_REQUEST_TYPE = 'esl.interaction.request';
export const AGENT_INTERACTION_SCHEMA_VERSION = 1;

/** 宿主专属的交互控件提示；ESL CLI 只表达建议，真正渲染交给 Agent 宿主。 */
export type AgentInteractionUiHint = 'AskUserQuestion';

export const AGENT_UI_HINTS: Partial<Record<ToolName, AgentInteractionUiHint>> = {
  claude: 'AskUserQuestion'
};

export type AgentInteractionFieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'confirm'
  | 'path';

export interface AgentInteractionField {
  id: string;
  kind: AgentInteractionFieldKind;
  label: string;
  description?: string;
  required?: boolean;
  default?: string | boolean | string[];
  options?: string[];
}

export interface AgentInteractionRequest {
  type: typeof AGENT_INTERACTION_REQUEST_TYPE;
  schemaVersion: typeof AGENT_INTERACTION_SCHEMA_VERSION;
  requestId: string;
  command: string;
  /** 发起本次调用的 AI 工具标识，来自 --agent-tool。 */
  agentTool?: ToolName;
  /** 宿主专属 UI 提示，例如 Claude Code 的 AskUserQuestion。 */
  uiHint?: AgentInteractionUiHint;
  fields: AgentInteractionField[];
}

export interface AgentInteractionRequestInput {
  command: string;
  fields: AgentInteractionField[];
  requestId?: string;
  agentTool?: ToolName;
}

export function createAgentInteractionRequest(
  input: AgentInteractionRequestInput
): AgentInteractionRequest {
  const uiHint = input.agentTool ? AGENT_UI_HINTS[input.agentTool] : undefined;
  return {
    type: AGENT_INTERACTION_REQUEST_TYPE,
    schemaVersion: AGENT_INTERACTION_SCHEMA_VERSION,
    requestId: input.requestId ?? `ir_${randomUUID()}`,
    command: input.command,
    ...(input.agentTool !== undefined ? { agentTool: input.agentTool } : {}),
    ...(uiHint !== undefined ? { uiHint } : {}),
    fields: input.fields
  };
}

export class AgentInteractionRequiredError extends Error {
  readonly request: AgentInteractionRequest;

  constructor(request: AgentInteractionRequest) {
    super(`Command ${request.command} requires user interaction`);
    this.name = 'AgentInteractionRequiredError';
    this.request = request;
  }
}
