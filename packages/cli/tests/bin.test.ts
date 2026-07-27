import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/bin/esl.js';

describe('esl program', () => {
  it('registers Phase 1 commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(expect.arrayContaining(['init', 'validate', 'version']));
  });
});
