import { describe, expect, it } from 'vitest';
import { CLI_NAME } from '../src/index.js';

describe('@esl/cli', () => {
  it('exports the CLI name', () => {
    expect(CLI_NAME).toBe('esl');
  });

  it('exports the source upload command', async () => {
    const module = await import('../src/commands/upload.js');
    expect(module.executeUpload).toBeTypeOf('function');
  });
});
