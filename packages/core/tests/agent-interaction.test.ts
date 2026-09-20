import { describe, expect, it } from 'vitest';
import {
  createAgentInteractionRequest,
  toAskUserQuestionPayload
} from '../src/agent-interaction.js';

describe('agent interaction request', () => {
  it('omits agentTool and uiHint when no agent tool is given', () => {
    const request = createAgentInteractionRequest({ command: 'init', fields: [] });

    expect(request).toEqual({
      type: 'esl.interaction.request',
      schemaVersion: 1,
      requestId: expect.stringMatching(/^ir_/),
      command: 'init',
      fields: []
    });
    expect('agentTool' in request).toBe(false);
    expect('uiHint' in request).toBe(false);
  });

  it('records the agent tool and adds the AskUserQuestion hint for claude', () => {
    const request = createAgentInteractionRequest({
      command: 'init',
      fields: [],
      agentTool: 'claude'
    });

    expect(request.agentTool).toBe('claude');
    expect(request.uiHint).toBe('AskUserQuestion');
  });

  it('records other agent tools without a host-specific hint', () => {
    const request = createAgentInteractionRequest({
      command: 'init',
      fields: [],
      agentTool: 'codex'
    });

    expect(request.agentTool).toBe('codex');
    expect(request.uiHint).toBeUndefined();
    expect('uiHint' in request).toBe(false);
  });
});

describe('toAskUserQuestionPayload', () => {
  const request = createAgentInteractionRequest({
    command: 'init',
    agentTool: 'claude',
    fields: [
      { id: 'description', kind: 'text', label: 'Skill description', required: true, default: 'Default description' },
      { id: 'license', kind: 'text', label: 'License', required: true, default: 'MIT' },
      { id: 'keywords', kind: 'multiselect', label: 'Keywords', required: false, default: [] },
      {
        id: 'namespace',
        kind: 'select',
        label: 'Namespace',
        required: true,
        default: 'personal',
        options: ['personal', 'acme']
      },
      { id: 'agree', kind: 'confirm', label: 'Agree', required: true, default: false }
    ]
  });

  it('maps each field to an AskUserQuestion question in order', () => {
    const payload = toAskUserQuestionPayload(request);

    expect(payload.metadata).toEqual({ source: 'esl-cli' });
    expect(payload.questions.map((question) => question.question)).toEqual([
      'Skill description',
      'License',
      'Keywords',
      'Namespace',
      'Agree'
    ]);
    expect(payload.questions.every((question) => question.header === question.question)).toBe(true);
  });

  it('offers the default as the only option for free-text fields', () => {
    const payload = toAskUserQuestionPayload(request);
    const [description, license] = payload.questions;

    expect(description.multiSelect).toBe(false);
    expect(description.options).toEqual([{ label: 'Default description', description: '默认值' }]);
    expect(license.options).toEqual([{ label: 'MIT', description: '默认值' }]);
  });

  it('maps select and multiselect options to labels', () => {
    const payload = toAskUserQuestionPayload(request);
    const [, , keywords, namespace] = payload.questions;

    expect(keywords.multiSelect).toBe(true);
    expect(keywords.options).toEqual([]);
    expect(namespace.multiSelect).toBe(false);
    expect(namespace.options).toEqual([{ label: 'personal' }, { label: 'acme' }]);
  });

  it('maps confirm to yes/no options', () => {
    const payload = toAskUserQuestionPayload(request);
    const [, , , , agree] = payload.questions;

    expect(agree.multiSelect).toBe(false);
    expect(agree.options).toEqual([
      { label: 'yes', description: '确认' },
      { label: 'no', description: '取消' }
    ]);
  });
});
