import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installTargetDir } from '../src/commands/network-options.js';

describe('network option paths', () => {
  it('keeps scope in the global skill install path', () => {
    const result = installTargetDir('@alice/code-review', {
      homeDir: 'C:\\temp\\esl-home'
    });

    expect(result).toBe(
      path.join('C:\\temp\\esl-home', '.skill-library', 'skills', '@alice', 'code-review')
    );
  });
});
