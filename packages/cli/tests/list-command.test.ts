import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/bin/esl.js';
import { executeList } from '../src/commands/list.js';
import { isInteractive } from '../src/prompt.js';
import type { SkillListEntry } from '@esl/core';

const { selectMock, checkboxMock, confirmMock, executeListMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  checkboxMock: vi.fn(),
  confirmMock: vi.fn(),
  executeListMock: vi.fn()
}));

vi.mock('@inquirer/prompts', () => ({
  checkbox: checkboxMock,
  confirm: confirmMock,
  input: vi.fn(),
  password: vi.fn(),
  select: selectMock
}));
vi.mock('../src/prompt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/prompt.js')>();
  return { ...actual, isInteractive: vi.fn() };
});
vi.mock('../src/commands/list.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/list.js')>();
  return { ...actual, executeList: executeListMock };
});

const ENTRIES: SkillListEntry[] = [
  {
    name: '@alice/code-review',
    version: '1.0.0',
    source: 'registry',
    displayName: 'Code Review',
    tools: [{ tool: 'claude', status: 'linked', managed: true }]
  },
  {
    name: '@local/my-helper',
    version: '0.1.0',
    source: 'link',
    linkSourcePath: '/tmp/my-helper',
    tools: [{ tool: 'codex', status: 'broken', managed: true }]
  }
];

describe('esl list read-only output', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(isInteractive).mockReturnValue(false);
    executeListMock.mockReset();
    selectMock.mockReset();
    checkboxMock.mockReset();
    confirmMock.mockReset();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints enriched JSON and never prompts', async () => {
    executeListMock.mockResolvedValue(ENTRIES);

    await createProgram().parseAsync(['node', 'esl', 'list', '--json']);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(JSON.parse(output)).toEqual(ENTRIES);
    expect(selectMock).not.toHaveBeenCalled();
    expect(checkboxMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('appends a tool summary to every human read-only line', async () => {
    executeListMock.mockResolvedValue(ENTRIES);

    await createProgram().parseAsync(['node', 'esl', 'list']);

    const lines = logSpy.mock.calls.map((call) => call.join(' '));
    expect(lines.some((line) => line.includes('Code Review (@alice/code-review)'))).toBe(true);
    expect(lines.some((line) => line.includes('v1.0.0') && line.includes('(registry)') && line.includes('tools: Claude Code'))).toBe(true);
    expect(lines.some((line) => line.includes('my-helper (@local/my-helper)') && line.includes('tools: Codex (broken)'))).toBe(true);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('keeps distinct empty-store messages for project and global scopes', async () => {
    executeListMock.mockResolvedValue([]);
    await createProgram().parseAsync(['node', 'esl', 'list']);
    expect(logSpy.mock.calls.some((call) => call.join(' ').includes('No skills installed in this project.'))).toBe(true);

    logSpy.mockClear();
    executeListMock.mockResolvedValue([]);
    await createProgram().parseAsync(['node', 'esl', 'list', '-g']);
    expect(logSpy.mock.calls.some((call) => call.join(' ').includes('No global skills installed.'))).toBe(true);
    expect(executeListMock).toHaveBeenLastCalledWith(expect.objectContaining({ global: true }));
  });
});
