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
          ],
          adopted: [],
          pruned: [],
          skipped: [],
          conflicts: []
        }
      ])
    ).toEqual([
      'codex: 2 skill(s) synced (@cnfox/code-review -> cnfox_code-review, @local/brainstorming -> local_brainstorming)'
    ]);
  });

  it('formats adapt ownership outcomes', () => {
    expect(
      formatAdaptResults([
        {
          tool: 'codex',
          skills: [],
          adopted: [{ identity: '@cnfox/code-review', directoryName: 'cnfox_code-review' }],
          pruned: [{ identity: '@cnfox/old-skill', directoryName: 'cnfox_old-skill', targetDir: 'unused' }],
          skipped: [{ identity: '@cnfox/skipped-skill', directoryName: 'cnfox_skipped-skill', targetDir: 'unused' }],
          conflicts: [{ identity: '@cnfox/conflict-skill', directoryName: 'cnfox_conflict-skill', targetDir: 'unused' }]
        }
      ])
    ).toEqual([
      'codex: 0 skill(s) synced (adopted: @cnfox/code-review -> cnfox_code-review; pruned: @cnfox/old-skill -> cnfox_old-skill; skipped: @cnfox/skipped-skill -> cnfox_skipped-skill; conflicts: @cnfox/conflict-skill -> cnfox_conflict-skill)'
    ]);
  });
});
