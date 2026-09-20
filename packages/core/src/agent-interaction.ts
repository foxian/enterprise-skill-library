import { randomUUID } from 'node:crypto';
import type { ToolName } from './link/tool-links.js';

export const AGENT_INTERACTION_REQUEST_TYPE = 'esl.interaction.request';
export const AGENT_INTERACTION_SCHEMA_VERSION = 1;

export type AgentInteractionFieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'confirm'
  | 'path';

export interface AgentInteractionOption {
  label: string;
  description?: string;
}

export interface AgentInteractionField {
  id: string;
  kind: AgentInteractionFieldKind;
  label: string;
  description?: string;
  required?: boolean;
  default?: string | boolean | string[];
  options?: Array<string | AgentInteractionOption>;
}

export interface AgentInteractionRequest {
  type: typeof AGENT_INTERACTION_REQUEST_TYPE;
  schemaVersion: typeof AGENT_INTERACTION_SCHEMA_VERSION;
  requestId: string;
  command: string;
  /** 发起本次调用的 AI 工具标识，来自 --agent-tool。 */
  agentTool?: ToolName;
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
  return {
    type: AGENT_INTERACTION_REQUEST_TYPE,
    schemaVersion: AGENT_INTERACTION_SCHEMA_VERSION,
    requestId: input.requestId ?? `ir_${randomUUID()}`,
    command: input.command,
    ...(input.agentTool !== undefined ? { agentTool: input.agentTool } : {}),
    fields: input.fields
  };
}

/** Claude Code AskUserQuestion 输入中单个选项。 */
export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

/** Claude Code AskUserQuestion 输入中的单个问题。 */
export interface AskUserQuestionQuestion {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

/** 与 Claude Code AskUserQuestion 工具输入一致的请求负载。 */
export interface AskUserQuestionPayload {
  questions: AskUserQuestionQuestion[];
  metadata?: { source?: string };
}

const ASK_USER_QUESTION_SOURCE = 'esl-cli';

/** 把字段映射为 AskUserQuestion 的一个问题；question/header 复用字段 label。 */
function fieldToAskUserQuestionQuestion(field: AgentInteractionField): AskUserQuestionQuestion {
  const question = field.label;
  let options: AskUserQuestionOption[];
  switch (field.kind) {
    case 'select':
    case 'multiselect':
      options = (field.options ?? []).map((option) =>
        typeof option === 'string' ? { label: option } : option
      );
      break;
    case 'confirm':
      options = [
        { label: 'yes', description: '确认' },
        { label: 'no', description: '取消' }
      ];
      break;
    default:
      // text / textarea / path：AskUserQuestion 只做选择题，把默认值作为快捷选项，
      // 自定义文本由用户走 Other 输入；没有默认值时不臆造选项。
      options =
        field.default !== undefined ? [{ label: String(field.default), description: '默认值' }] : [];
      break;
  }
  return {
    question,
    header: question,
    options,
    multiSelect: field.kind === 'multiselect'
  };
}

/** 把内部交互字段映射为 Claude Code AskUserQuestion 风格的 JSON 负载。 */
export function toAskUserQuestionPayload(
  request: AgentInteractionRequest
): AskUserQuestionPayload {
  return {
    questions: request.fields.map(fieldToAskUserQuestionQuestion),
    metadata: { source: ASK_USER_QUESTION_SOURCE }
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
