import { describe, expect, it } from 'vitest';
import { formatAdaptResults } from '../src/commands/adapt.js';

describe('esl adapt', () => {
  it('formats source-to-runtime mappings', () => {
    expect(
      formatAdaptResults([
        {
          tool: 'codex',
          skills: [
            { identity: '@cnfox/code-review', directoryName: 'cnfox_code-review' },
            { identity: '@local/brainstorming', directoryName: 'local_brainstorming' }
          ]
        }
      ])
    ).toEqual([
      'codex: 2 skill(s) synced (@cnfox/code-review -> cnfox_code-review, @local/brainstorming -> local_brainstorming)'
    ]);
  });
});
