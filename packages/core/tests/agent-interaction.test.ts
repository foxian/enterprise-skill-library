import { describe, expect, it } from 'vitest';
import { createAgentInteractionRequest } from '../src/agent-interaction.js';

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
