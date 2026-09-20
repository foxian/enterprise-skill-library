import { randomUUID } from 'node:crypto';

export const AGENT_INTERACTION_REQUEST_TYPE = 'esl.interaction.request';
export const AGENT_INTERACTION_SCHEMA_VERSION = 1;

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
  fields: AgentInteractionField[];
}

export interface AgentInteractionRequestInput {
  command: string;
  fields: AgentInteractionField[];
  requestId?: string;
}

export function createAgentInteractionRequest(
  input: AgentInteractionRequestInput
): AgentInteractionRequest {
  return {
    type: AGENT_INTERACTION_REQUEST_TYPE,
    schemaVersion: AGENT_INTERACTION_SCHEMA_VERSION,
    requestId: input.requestId ?? `ir_${randomUUID()}`,
    command: input.command,
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
