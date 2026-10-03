import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram, formatErrorMessage, isDirectCliEntry, promptToolSelection, run } from '../src/bin/esl.js';
import { executeInstall, resolveDefaultInstallTools } from '../src/commands/install.js';
import { executeInit } from '../src/commands/init.js';
import { executeLink, resolveLinkIdentity } from '../src/commands/link.js';
import { SUPPORTED_TOOLS, initializeLocalStore, saveConfig } from '@esl/core';
import { executeUpload } from '../src/commands/upload.js';
import { executePublish } from '../src/commands/publish.js';
import { executeToolsRemove } from '../src/commands/tools.js';
import { isInteractive } from '../src/prompt.js';
import { readCliVersion } from '../src/version.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const { checkboxMock, confirmMock, executeSearchMock, inputMock, selectMock } = vi.hoisted(() => ({
  checkboxMock: vi.fn(),
  confirmMock: vi.fn(),
  executeSearchMock: vi.fn(),
  inputMock: vi.fn(),
  selectMock: vi.fn()
}));

vi.mock('@inquirer/prompts', () => ({
  checkbox: checkboxMock,
  confirm: confirmMock,
  input: inputMock,
  password: vi.fn(),
  select: selectMock
}));
vi.mock('../src/commands/search.js', () => ({ executeSearch: executeSearchMock }));
vi.mock('../src/prompt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/prompt.js')>();
  return { ...actual, isInteractive: vi.fn() };
});
vi.mock('../src/commands/upload.js', () => ({ executeUpload: vi.fn() }));
vi.mock('../src/commands/publish.js', () => ({ executePublish: vi.fn() }));
const {
  executeDependAddMock,
  executeDependListMock,
  executeDependRemoveMock
} = vi.hoisted(() => ({
  executeDependAddMock: vi.fn(),
  executeDependListMock: vi.fn(),
  executeDependRemoveMock: vi.fn()
}));
vi.mock('../src/commands/depend.js', () => ({
  executeDependAdd: executeDependAddMock,
  executeDependList: executeDependListMock,
  executeDependRemove: executeDependRemoveMock,
  formatDependList: (result: { dependencies: Record<string, string> }) =>
    Object.entries(result.dependencies).map(([identity, range]) => `${identity} ${range}`).join('\n')
}));
vi.mock('../src/commands/link.js', () => ({
  executeLink: vi.fn(),
  resolveLinkIdentity: vi.fn()
}));
vi.mock('../src/commands/tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/tools.js')>();
  return { ...actual, executeToolsRemove: vi.fn() };
});
vi.mock('../src/commands/install.js', () => ({
  executeInstall: vi.fn(),
  resolveDefaultInstallTools: vi.fn()
}));

describe('esl program', () => {
  function withTempCwd(): { root: string; restore: () => void } {
    const originalCwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-bin-cwd-'));
    process.chdir(root);
    return {
      root,
      restore: () => {
        process.chdir(originalCwd);
        fs.rmSync(root, { recursive: true, force: true });
      }
    };
  }

  function writeStoreManifests(root: string, skills: Record<string, unknown>): void {
    fs.mkdirSync(path.join(root, '.eslib'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.eslib', '.esl-install-manifest.json'),
      `${JSON.stringify({ version: 1, skills }, null, 2)}\n`
    );
  }

  function installManifestEntry(identity: string, source: string): Record<string, unknown> {
    return {
      identity,
      version: '1.0.0',
      source,
      specifier: '^1.0.0',
      sourceDir: `skills/${identity.replace('@', '').replace('/', '/')}`,
      installedAt: '2026-01-01T00:00:00.000Z'
    };
  }

  beforeEach(() => {
    vi.mocked(isInteractive).mockReturnValue(false);
    vi.mocked(resolveLinkIdentity).mockReset();
    checkboxMock.mockReset();
    confirmMock.mockReset();
    executeSearchMock.mockReset();
    inputMock.mockReset();
    selectMock.mockReset();
    vi.mocked(executeInstall).mockReset();
    vi.mocked(resolveDefaultInstallTools).mockReset();
    executeDependAddMock.mockReset();
    executeDependListMock.mockReset();
    executeDependRemoveMock.mockReset();
  });

  it('returns the tools selected from the checkbox prompt', async () => {
    const selectTools = vi.fn().mockResolvedValue(['claude', 'codex']);

    await expect(promptToolSelection(selectTools)).resolves.toEqual(['claude', 'codex']);
  });

  it('labels checkbox choices with tool display names while keeping canonical ids', async () => {
    const selectTools = vi.fn().mockResolvedValue(['claude']);

    await promptToolSelection(selectTools);

    expect(selectTools).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({ name: 'Claude Code', value: 'claude' }),
          expect.objectContaining({ name: 'Trae International', value: 'trae-intl' })
        ])
      })
    );
  });

  it('passes configured default tools to link instead of an empty list', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@acme/review' });
      vi.mocked(resolveDefaultInstallTools).mockResolvedValueOnce(['claude', 'codex']);
      vi.mocked(executeLink).mockResolvedValueOnce('/tmp/linked-target');
      const program = createProgram();

      await program.parseAsync(['link', './my-skill', '--no-input'], { from: 'user' });

      expect(executeLink).toHaveBeenCalledWith(
        './my-skill',
        expect.objectContaining({ tools: ['claude', 'codex'] })
      );
    } finally {
      tmp.restore();
    }
  });

  it('prompts the tool checkbox on interactive install even when default tools are configured', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      vi.mocked(resolveDefaultInstallTools).mockResolvedValueOnce(['cursor']);
      vi.mocked(executeInstall).mockResolvedValueOnce('/tmp/installed');
      checkboxMock.mockResolvedValueOnce(['claude']);
      const program = createProgram();

      await program.parseAsync(['install', '@acme/review'], { from: 'user' });

      expect(checkboxMock).toHaveBeenCalledTimes(1);
      expect(executeInstall).toHaveBeenCalledWith(
        '@acme/review',
        expect.objectContaining({ tools: ['claude'] })
      );
    } finally {
      tmp.restore();
    }
  });

  it('confirms overwriting an existing install and aborts when declined', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'registry')
      });
      confirmMock.mockResolvedValueOnce(false);
      vi.mocked(executeInstall).mockClear();
      const program = createProgram();

      await program.parseAsync(['install', '@acme/review'], { from: 'user' });

      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(confirmMock.mock.calls[0][0]).toMatchObject({
        message: expect.stringContaining('already installed')
      });
      expect(executeInstall).not.toHaveBeenCalled();
      expect(checkboxMock).not.toHaveBeenCalled();
    } finally {
      tmp.restore();
    }
  });

  it('overwrites and continues to tool selection when the overwrite confirmation is accepted', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'registry')
      });
      confirmMock.mockResolvedValueOnce(true);
      checkboxMock.mockResolvedValueOnce(['claude']);
      vi.mocked(executeInstall).mockResolvedValueOnce('/tmp/installed');
      const program = createProgram();

      await program.parseAsync(['install', '@acme/review'], { from: 'user' });

      expect(executeInstall).toHaveBeenCalledWith(
        '@acme/review',
        expect.objectContaining({ tools: ['claude'] })
      );
    } finally {
      tmp.restore();
    }
  });

  it('confirms the Skill Source Link conversion before tool selection on install', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'link')
      });
      confirmMock.mockResolvedValueOnce(true);
      checkboxMock.mockResolvedValueOnce(['claude']);
      vi.mocked(executeInstall).mockResolvedValueOnce('/tmp/installed');
      const program = createProgram();

      await program.parseAsync(['install', '@acme/review'], { from: 'user' });

      expect(confirmMock.mock.calls[0][0]).toMatchObject({
        message: expect.stringContaining('Skill Source Link')
      });
      expect(confirmMock.mock.invocationCallOrder[0]).toBeLessThan(
        checkboxMock.mock.invocationCallOrder[0]
      );
      expect(executeInstall).toHaveBeenCalled();
    } finally {
      tmp.restore();
    }
  });

  it('rejects replacing a Skill Source Link without --force when not interactive', async () => {
    const tmp = withTempCwd();
    try {
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'link')
      });
      vi.mocked(executeInstall).mockClear();
      const program = createProgram();

      await expect(
        program.parseAsync(['install', '@acme/review', '--no-input'], { from: 'user' })
      ).rejects.toThrow(/Skill Source Link/);

      expect(executeInstall).not.toHaveBeenCalled();
      expect(confirmMock).not.toHaveBeenCalled();
    } finally {
      tmp.restore();
    }
  });

  it('confirms replacing a plain install with a Skill Source Link and aborts when declined', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@acme/review' });
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'registry')
      });
      confirmMock.mockResolvedValueOnce(false);
      vi.mocked(executeLink).mockClear();
      const program = createProgram();

      await program.parseAsync(['link', './my-skill'], { from: 'user' });

      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(confirmMock.mock.calls[0][0]).toMatchObject({
        message: expect.stringContaining('Skill Source Link')
      });
      expect(executeLink).not.toHaveBeenCalled();
      expect(checkboxMock).not.toHaveBeenCalled();
    } finally {
      tmp.restore();
    }
  });

  it('enters link staging after the conversion confirmation and prompts tool selection', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@acme/review' });
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'registry')
      });
      confirmMock.mockResolvedValueOnce(true);
      checkboxMock.mockResolvedValueOnce(['claude']);
      vi.mocked(executeLink).mockResolvedValueOnce('/tmp/linked-target');
      const program = createProgram();

      await program.parseAsync(['link', './my-skill'], { from: 'user' });

      expect(executeLink).toHaveBeenCalledWith(
        './my-skill',
        expect.objectContaining({ force: true, tools: ['claude'] })
      );
    } finally {
      tmp.restore();
    }
  });

  it('rejects an empty checkbox selection', async () => {
    const selectTools = vi.fn().mockResolvedValue([]);

    await expect(promptToolSelection(selectTools)).rejects.toThrow('No tools selected');
  });

  it('propagates checkbox cancellation', async () => {
    const cancellation = new Error('canceled');
    const selectTools = vi.fn().mockRejectedValue(cancellation);

    await expect(promptToolSelection(selectTools)).rejects.toBe(cancellation);
  });

  it('registers Phase 1 commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(
      expect.arrayContaining([
        'init',
        'validate',
        'version',
        'install',
        'list',
        'use',
        'source',
        'update',
        'uninstall',
        'share'
      ])
    );
    expect(commandNames).not.toContain('admin');
    expect(commandNames).not.toContain('delete');
  });

  it('registers the whoami command', () => {
    const program = createProgram();
    const whoami = program.commands.find((command) => command.name() === 'whoami');

    expect(whoami).toBeDefined();
    expect(whoami?.options.map((option) => option.long)).toEqual([]);
  });

  it('registers the config set-server command and makes login options optional', () => {
    const program = createProgram();
    const config = program.commands.find((command) => command.name() === 'config');
    const login = program.commands.find((command) => command.name() === 'login');
    const serverOption = login?.options.find((option) => option.long === '--server');
    const usernameOption = login?.options.find((option) => option.long === '--username');

    expect(config?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['set-server']));
    expect(serverOption?.mandatory).toBe(false);
    expect(usernameOption?.mandatory).toBe(false);
  });

  it('registers the top-level account command surface', () => {
    const program = createProgram();
    const account = program.commands.find((command) => command.name() === 'account');

    expect(account?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['change-password']));
  });

  it('registers --json on info and search', () => {
    const program = createProgram();
    const info = program.commands.find((command) => command.name() === 'info');
    const search = program.commands.find((command) => command.name() === 'search');

    expect(info?.options.map((option) => option.long)).toContain('--json');
    expect(search?.options.map((option) => option.long)).toContain('--json');
  });

  it('registers the search discovery flags with an optional query', () => {
    const program = createProgram();
    const search = program.commands.find((command) => command.name() === 'search');
    const options = search?.options.map((option) => option.long) ?? [];

    expect(options).toEqual(expect.arrayContaining(['--namespace', '--keyword', '--visibility', '--limit']));
    expect((search?.options.find((option) => option.long === '--visibility') as { argChoices?: string[] }).argChoices)
      .toEqual(['public', 'private']);
    expect((search as unknown as { _args: Array<{ required: boolean }> })._args[0].required).toBe(false);
  });

  it('search TTY session installs after echoing the full command and confirming', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    executeSearchMock.mockResolvedValue([
      { name: '@acme/tool', description: 'Org tool', displayName: 'tool', latestStableVersion: '1.0.0', visibility: 'public' },
      { name: '@beta/lib', description: 'Beta library', latestStableVersion: '1.2.0', visibility: 'public' }
    ]);
    vi.mocked(resolveDefaultInstallTools).mockResolvedValue(['claude']);
    vi.mocked(executeInstall).mockResolvedValue('/store/@acme/tool');
    selectMock.mockResolvedValueOnce('@acme/tool');
    selectMock.mockResolvedValueOnce('install');
    confirmMock.mockResolvedValueOnce(true);
    checkboxMock.mockResolvedValueOnce(['claude']);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    try {
      await run(['node', 'esl', 'search', '--server', 'http://search.example']);
    } finally {
      logSpy.mockRestore();
    }

    expect(executeSearchMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ server: 'http://search.example' }));
    const listCall = selectMock.mock.calls[0][0] as { default?: string; choices: Array<{ name: string }> };
    expect(listCall.default).toBe('@acme/tool');
    expect(listCall.choices[0].name).toBe('Adjust filters…');
    expect(listCall.choices.at(-1)?.name).toBe('Exit');
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(logs.join('\n')).toContain('$ esl install @acme/tool --server http://search.example');
    expect(executeInstall).toHaveBeenCalledWith('@acme/tool', expect.objectContaining({ tools: ['claude'] }));
  });

  it('search TTY session keeps the full flow for one result and uses configured tools', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    executeSearchMock.mockResolvedValue([
      { name: '@acme/tool', description: 'Org tool', latestStableVersion: '1.0.0', visibility: 'public' }
    ]);
    vi.mocked(resolveDefaultInstallTools).mockResolvedValue(['claude']);
    vi.mocked(executeInstall).mockResolvedValue('/store/@acme/tool');
    selectMock.mockResolvedValueOnce('@acme/tool');
    selectMock.mockResolvedValueOnce('install');
    confirmMock.mockResolvedValueOnce(true);
    checkboxMock.mockResolvedValueOnce(['claude']);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await run(['node', 'esl', 'search']);
    } finally {
      logSpy.mockRestore();
    }

    expect(executeSearchMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(executeInstall).toHaveBeenCalledWith('@acme/tool', expect.objectContaining({ tools: ['claude'] }));
  });

  it('search TTY session returns to the list without installing when the confirm is rejected', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    executeSearchMock.mockResolvedValue([
      { name: '@acme/tool', description: 'Org tool', latestStableVersion: '1.0.0', visibility: 'public' }
    ]);
    selectMock.mockResolvedValueOnce('@acme/tool');
    selectMock.mockResolvedValueOnce('install');
    confirmMock.mockResolvedValueOnce(false);
    selectMock.mockResolvedValueOnce('__exit__');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await run(['node', 'esl', 'search']);
    } finally {
      logSpy.mockRestore();
    }

    expect(executeInstall).not.toHaveBeenCalled();
    expect(executeSearchMock).toHaveBeenCalledTimes(1);
  });

  it('search TTY session offers adjust or exit when nothing matches', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    executeSearchMock.mockResolvedValue([]);
    selectMock.mockResolvedValueOnce('__exit__');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await run(['node', 'esl', 'search', 'missing']);
    } finally {
      logSpy.mockRestore();
    }

    const listCall = selectMock.mock.calls[0][0] as { choices: Array<{ name: string }> };
    expect(listCall.choices.map((choice) => choice.name)).toEqual(['Adjust filters…', 'Exit']);
    expect(executeInstall).not.toHaveBeenCalled();
  });

  it('search does not prompt in json or no-input mode', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    executeSearchMock.mockResolvedValue([
      { name: '@acme/tool', description: 'Org tool', latestStableVersion: '1.0.0', visibility: 'public' }
    ]);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    try {
      await run(['node', 'esl', 'search', '--json']);
      await run(['node', 'esl', 'search', '--no-input']);
    } finally {
      logSpy.mockRestore();
    }

    expect(selectMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(JSON.parse(logs[0])).toEqual([
      { name: '@acme/tool', description: 'Org tool', latestStableVersion: '1.0.0', visibility: 'public' }
    ]);
    expect(logs[1]).toContain('@acme/tool');
  });

  it('uses --server for ESL Server commands and does not expose old network flags', () => {
    const program = createProgram();
    const commandNames = ['login', 'search', 'info', 'publish', 'install', 'source', 'use', 'update'];

    for (const commandName of commandNames) {
      const command = program.commands.find((entry) => entry.name() === commandName);
      const options = command?.options.map((option) => option.long) ?? [];
      expect(options, commandName).toContain('--server');
      expect(options, commandName).not.toContain('--registry');
      expect(options, commandName).not.toContain('--git-base');
    }
  });

  it('registers the debug option', () => {
    const program = createProgram();
    expect(program.options.map((option) => option.long)).toContain('--debug');
  });

  it('registers --force on publish and uninstall and --no-input globally', () => {
    const program = createProgram();
    const publish = program.commands.find((command) => command.name() === 'publish');
    const uninstall = program.commands.find((command) => command.name() === 'uninstall');

    expect(publish?.options.map((option) => option.long)).toContain('--force');
    expect(uninstall?.options.map((option) => option.long)).toContain('--force');
    expect(program.options.map((option) => option.long)).toContain('--no-input');
  });

  it('registers a temporary locale override', () => {
    const program = createProgram();
    expect(program.options.map((option) => option.long)).toContain('--locale');
  });

  it('registers --tools and --no-tools on install', () => {
    const program = createProgram();
    const install = program.commands.find((command) => command.name() === 'install');
    const options = install?.options.map((option) => option.long) ?? [];

    expect(options).toContain('--tools');
    expect(options).toContain('--no-tools');
  });

  it('maps install --no-tools to a source-only install', async () => {
    vi.mocked(executeInstall).mockResolvedValueOnce('/tmp/skill');
    const program = createProgram();

    await program.parseAsync(['install', '@acme/review', '--no-tools'], { from: 'user' });

    expect(executeInstall).toHaveBeenCalledWith(
      '@acme/review',
      expect.objectContaining({ tools: [], noAdapt: true })
    );
  });

  it('maps install --tools all to all supported tools', async () => {
    vi.mocked(executeInstall).mockResolvedValueOnce('/tmp/skill');
    const program = createProgram();

    await program.parseAsync(['install', '@acme/review', '--tools', 'all'], { from: 'user' });

    expect(executeInstall).toHaveBeenCalledWith(
      '@acme/review',
      expect.objectContaining({ tools: [...SUPPORTED_TOOLS], noAdapt: false })
    );
  });

  it('fails non-interactively when no tools are configured', async () => {
    vi.mocked(executeInstall).mockClear();
    vi.mocked(resolveDefaultInstallTools).mockResolvedValueOnce([]);
    const program = createProgram();

    await expect(
      program.parseAsync(['install', '@acme/review'], { from: 'user' })
    ).rejects.toThrow('No tools configured');

    expect(executeInstall).not.toHaveBeenCalled();
  });

  it('does not prompt for install under --no-input', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      vi.mocked(resolveDefaultInstallTools).mockResolvedValueOnce([]);
      vi.mocked(executeInstall).mockClear();
      const program = createProgram();

      await expect(
        program.parseAsync(['install', '@acme/review', '--no-input'], { from: 'user' })
      ).rejects.toThrow('No tools configured');

      expect(checkboxMock).not.toHaveBeenCalled();
      expect(executeInstall).not.toHaveBeenCalled();
    } finally {
      tmp.restore();
    }
  });

  it('does not prompt for link under --no-input', async () => {
    const tmp = withTempCwd();
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@acme/review' });
      vi.mocked(resolveDefaultInstallTools).mockResolvedValueOnce([]);
      vi.mocked(executeLink).mockClear();
      const program = createProgram();

      await expect(
        program.parseAsync(['link', './my-skill', '--no-input'], { from: 'user' })
      ).rejects.toThrow('No tools configured');

      expect(checkboxMock).not.toHaveBeenCalled();
      expect(executeLink).not.toHaveBeenCalled();
    } finally {
      tmp.restore();
    }
  });

  it('does not prompt for tools remove under --no-input', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    vi.mocked(executeToolsRemove).mockClear();
    const program = createProgram();

    await expect(
      program.parseAsync(['tools', 'remove', '@acme/review', '--no-input'], { from: 'user' })
    ).rejects.toThrow('No tools selected');

    expect(checkboxMock).not.toHaveBeenCalled();
    expect(executeToolsRemove).not.toHaveBeenCalled();
  });

  it('does not resolve tools when install uses --no-adapt', async () => {
    vi.mocked(executeInstall).mockResolvedValueOnce('/tmp/skill');
    vi.mocked(resolveDefaultInstallTools).mockClear();
    const program = createProgram();

    await program.parseAsync(['install', '@acme/review', '--no-adapt'], { from: 'user' });

    expect(resolveDefaultInstallTools).not.toHaveBeenCalled();
    expect(executeInstall).toHaveBeenCalledWith(
      '@acme/review',
      expect.objectContaining({ tools: [], noAdapt: true })
    );
  });

  it('registers --project on tools list', () => {
    const program = createProgram();
    const tools = program.commands.find((command) => command.name() === 'tools');
    const list = tools?.commands.find((command) => command.name() === 'list');

    expect(list?.options.map((option) => option.long)).toContain('--project');
  });

  it('emits an agent tools multiselect for install when --tools is missing', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
    try {
      vi.mocked(executeInstall).mockClear();
      await run(['node', 'esl', 'install', '@acme/review', '--agent-interaction']);

      expect(process.exitCode).toBe(2);
      expect(executeInstall).not.toHaveBeenCalled();
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{
          question: string;
          options: Array<{ label: string; description?: string }>;
          multiSelect: boolean;
        }>;
      };
      expect(payload.questions).toHaveLength(1);
      expect(payload.questions[0].multiSelect).toBe(true);
      expect(payload.questions[0].question).toContain('First tool mount');
      expect(payload.questions[0].options[0]).toEqual({ label: 'Claude Code', description: 'id: claude' });
    } finally {
      stdoutSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('completes agent install with --tools without any confirm', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    try {
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'registry')
      });
      vi.mocked(executeInstall).mockResolvedValueOnce('/tmp/installed');

      await run(['node', 'esl', 'install', '@acme/review', '--agent-interaction', '--tools', 'claude']);

      expect(process.exitCode).toBeUndefined();
      expect(confirmMock).not.toHaveBeenCalled();
      expect(checkboxMock).not.toHaveBeenCalled();
      expect(executeInstall).toHaveBeenCalledWith(
        '@acme/review',
        expect.objectContaining({ tools: ['claude'] })
      );
    } finally {
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('refuses agent install over a Skill Source Link without --force', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    process.exitCode = undefined;
    try {
      writeStoreManifests(tmp.root, {
        '@acme/review': installManifestEntry('@acme/review', 'link')
      });
      vi.mocked(executeInstall).mockClear();

      await run(['node', 'esl', 'install', '@acme/review', '--agent-interaction', '--tools', 'claude']);

      expect(process.exitCode).toBe(1);
      expect(stderr.join('')).toContain('Skill Source Link');
      expect(stdout.join('')).not.toContain('questions');
      expect(executeInstall).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('emits an agent tools multiselect for link when --tools is missing', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
    try {
      vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@acme/review' });
      vi.mocked(executeLink).mockClear();

      await run(['node', 'esl', 'link', './my-skill', '--agent-interaction']);

      expect(process.exitCode).toBe(2);
      expect(executeLink).not.toHaveBeenCalled();
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{ multiSelect: boolean; question: string }>;
      };
      expect(payload.questions[0].multiSelect).toBe(true);
    } finally {
      stdoutSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('counts interactive install selections toward preferred tools', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-count-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    try {
      await initializeLocalStore({ homeDir });
      vi.mocked(isInteractive).mockReturnValue(true);
      checkboxMock.mockResolvedValue(['claude']);
      vi.mocked(executeInstall).mockResolvedValue('/tmp/installed');
      const program = createProgram();

      await program.parseAsync(['install', '@acme/review'], { from: 'user' });
      await program.parseAsync(['install', '@acme/review'], { from: 'user' });

      const config = JSON.parse(
        fs.readFileSync(path.join(homeDir, '.eslib', 'config.json'), 'utf8')
      );
      expect(config.tools).toContain('claude');
      expect(config.toolSelectionCounts).toMatchObject({ claude: 2 });
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('does not count bare --tools installs toward preferred tools', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-count-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    try {
      await initializeLocalStore({ homeDir });
      vi.mocked(executeInstall).mockResolvedValue('/tmp/installed');
      const program = createProgram();

      await program.parseAsync(['install', '@acme/review', '--tools', 'claude'], { from: 'user' });

      const config = JSON.parse(
        fs.readFileSync(path.join(homeDir, '.eslib', 'config.json'), 'utf8')
      );
      expect(config.tools).toEqual([]);
      expect(config.toolSelectionCounts).toBeUndefined();
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('counts agent reruns with --tools toward preferred tools', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-count-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    try {
      await initializeLocalStore({ homeDir });
      vi.mocked(executeInstall).mockResolvedValue('/tmp/installed');
      const program = createProgram();

      await program.parseAsync(['install', '@acme/review', '--agent-interaction', '--tools', 'codex'], { from: 'user' });
      await program.parseAsync(['install', '@acme/review', '--agent-interaction', '--tools', 'codex'], { from: 'user' });

      const config = JSON.parse(
        fs.readFileSync(path.join(homeDir, '.eslib', 'config.json'), 'utf8')
      );
      expect(config.tools).toContain('codex');
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('lists preferred tools as JSON without prompting even in a TTY', async () => {
    const tmp = withTempCwd();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-preferred-home-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(' '));
    });
    try {
      await initializeLocalStore({ homeDir });
      await saveConfig({ tools: ['claude'] }, { homeDir });
      vi.mocked(isInteractive).mockReturnValue(true);

      await run(['node', 'esl', 'tools', 'preferred', '--json']);

      expect(JSON.parse(stdout.join(''))).toEqual(['claude']);
      expect(checkboxMock).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      homedirSpy.mockRestore();
      fs.rmSync(homeDir, { recursive: true, force: true });
      tmp.restore();
    }
  });

  it('registers tools sync and drops update --tools/--force', () => {
    const program = createProgram();
    const tools = program.commands.find((command) => command.name() === 'tools');
    expect(tools?.commands.map((command) => command.name())).toContain('sync');
    const update = program.commands.find((command) => command.name() === 'update');
    expect(update?.options.map((option) => option.long)).not.toContain('--tools');
    expect(update?.options.map((option) => option.long)).not.toContain('--force');
  });

  it('registers depend with add, remove, and list subcommands', () => {
    const program = createProgram();
    const depend = program.commands.find((command) => command.name() === 'depend');
    expect(depend).toBeDefined();
    expect(depend?.commands.map((command) => command.name())).toEqual(['add', 'remove', 'list']);
    expect(depend?.description()).toContain('release.json');
  });

  it('routes bare depend and depend list to the source manifest list', async () => {
    executeDependListMock.mockResolvedValue({ dependencies: { '@acme/base': '^1.2.0' } });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    try {
      await run(['node', 'esl', 'depend', './src']);
      await run(['node', 'esl', 'depend', 'list', '--json']);
    } finally {
      logSpy.mockRestore();
    }

    expect(executeDependListMock).toHaveBeenNthCalledWith(1, { directory: './src' });
    expect(executeDependListMock).toHaveBeenNthCalledWith(2, { directory: undefined });
    expect(logs).toContain('@acme/base ^1.2.0');
    expect(logs).toContain(JSON.stringify({ dependencies: { '@acme/base': '^1.2.0' } }, null, 2));
  });

  it('routes depend add and remove to the source manifest edits', async () => {
    executeDependAddMock.mockResolvedValue({ identity: '@acme/base', range: '^1.2.0', updated: false });
    executeDependRemoveMock.mockResolvedValue({ identity: '@acme/base' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await run(['node', 'esl', 'depend', 'add', '@acme/base@^1.2.0', './src']);
      await run(['node', 'esl', 'depend', 'remove', '@acme/base']);
    } finally {
      logSpy.mockRestore();
    }

    expect(executeDependAddMock).toHaveBeenCalledWith('@acme/base@^1.2.0', { directory: './src' });
    expect(executeDependRemoveMock).toHaveBeenCalledWith('@acme/base', { directory: undefined });
  });

  it('registers the release tag repair command', () => {
    const program = createProgram();
    const repairTag = program.commands.find((command) => command.name() === 'repair-tag');

    expect(repairTag).toBeDefined();
    expect(repairTag?.options.map((option) => option.long)).toContain('--server');
  });

  it('formats errors as a single line without a stack trace', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at foo (file.ts:1:1)';

    const message = formatErrorMessage(error);

    expect(message).toContain('Error: boom');
    expect(message).toContain('--debug');
    expect(message).not.toContain('at foo');
  });

  it('formats non-Error throws', () => {
    expect(formatErrorMessage('plain string')).toContain('Error: plain string');
  });

  it('formats API errors in the requested locale', () => {
    const error = Object.assign(new Error('Unauthorized: invalid credentials'), {
      code: 'unauthorizedInvalidCredentials',
      params: {}
    });

    expect(formatErrorMessage(error, 'zh-CN')).toContain('Error: 未认证：凭据无效');
  });

  it('localizes the missing-git error in the requested locale', () => {
    const error = Object.assign(
      new Error(
        'Git is required for this command. Install git (on Windows: https://git-scm.com/download/win) and make sure it is on your PATH.'
      ),
      { code: 'cliGitMissing', params: {} }
    );

    expect(formatErrorMessage(error, 'zh-CN')).toContain('Error: 该命令需要 git');
    expect(formatErrorMessage(error, 'zh-CN')).toContain('https://git-scm.com/download/win');
  });

  it('reports the CLI version from the package manifest', () => {
    const expectedVersion = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ).version as string;
    expect(readCliVersion()).toBe(expectedVersion);
    const program = createProgram();
    expect(program.version()).toBe(expectedVersion);
  });

  it('includes an example in every command help', () => {
    const program = createProgram();
    for (const command of program.commands) {
      const chunks: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      });
      try {
        command.outputHelp();
      } finally {
        spy.mockRestore();
      }
      expect(chunks.join(''), `help for ${command.name()}`).toContain('Example');
    }
  });

  it('documents optional unlink skill-name-or-path', () => {
    const program = createProgram();
    const command = program.commands.find((entry) => entry.name() === 'unlink');
    expect(command).toBeDefined();
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      command!.outputHelp();
    } finally {
      spy.mockRestore();
    }
    const help = chunks.join('');
    expect(help).toContain('[skill-name-or-path]');
    expect(help).toContain('esl unlink -g');
    expect(help).toContain('esl unlink ./my-skill');
  });

  it('exposes -g/--global and -m/--message short flags', () => {
    const program = createProgram();
    const captureHelp = (commandName: string): string => {
      const command = program.commands.find((entry) => entry.name() === commandName);
      expect(command).toBeDefined();
      const chunks: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      });
      try {
        command!.outputHelp();
      } finally {
        spy.mockRestore();
      }
      return chunks.join('');
    };

    expect(captureHelp('install')).toMatch(/-g,\s*--global/);
    expect(captureHelp('publish')).toMatch(/-m,\s*--message/);
    expect(captureHelp('release-delete')).toMatch(/--force/);
    expect(captureHelp('release-delete')).not.toMatch(/-f,\s*--force/);
  });

  // file:///D:/… → D:\… 的 URL→路径语义只在 Windows 上成立；Linux 的
  // fileURLToPath 会把它解析成 /D:/…，跨平台模拟没有意义。
  it.runIf(process.platform === 'win32')('detects direct execution from Windows paths', () => {
    expect(isDirectCliEntry('file:///D:/DevProjects/esl/packages/cli/dist/bin/esl.js', 'D:\\DevProjects\\esl\\packages\\cli\\dist\\bin\\esl.js')).toBe(true);
  });

  it('detects direct execution through npm workspace symlinks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-bin-'));
    try {
      const realDir = path.join(tmpDir, 'packages', 'cli', 'dist', 'bin');
      const linkDir = path.join(tmpDir, 'node_modules', '@esl', 'cli');
      fs.mkdirSync(realDir, { recursive: true });
      fs.mkdirSync(path.dirname(linkDir), { recursive: true });
      fs.writeFileSync(path.join(realDir, 'esl.js'), '');
      fs.symlinkSync(path.join(tmpDir, 'packages', 'cli'), linkDir, 'junction');

      expect(
        isDirectCliEntry(
          pathToFileURL(path.join(realDir, 'esl.js')).href,
          path.join(linkDir, 'dist', 'bin', 'esl.js')
        )
      ).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('enters the interactive list session on a TTY and keeps tool names out of level 1', async () => {
    const tmp = withTempCwd();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeStoreManifests(process.cwd(), { '@acme/review': installManifestEntry('@acme/review', 'registry') });
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      selectMock.mockResolvedValueOnce('@acme/review');
      selectMock.mockResolvedValueOnce('__exit__');
      const program = createProgram();

      await program.parseAsync(['list'], { from: 'user' });

      expect(selectMock).toHaveBeenCalled();
      const [level1] = selectMock.mock.calls[0] as [{ message: string; choices: Array<{ name: string; value: string }> }];
      expect(level1.message).toBe('Select a skill to manage');
      const labels = level1.choices.map((choice) => choice.name).join('\n');
      expect(labels).toContain('@acme/review');
      expect(labels).not.toContain('Claude Code');
      expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('Store path:');
    } finally {
      logSpy.mockRestore();
      tmp.restore();
    }
  });

  it('stays read-only for list under --no-input even on a TTY', async () => {
    const tmp = withTempCwd();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeStoreManifests(process.cwd(), { '@acme/review': installManifestEntry('@acme/review', 'registry') });
    try {
      vi.mocked(isInteractive).mockReturnValue(true);
      const program = createProgram();

      await program.parseAsync(['list', '--no-input'], { from: 'user' });

      expect(selectMock).not.toHaveBeenCalled();
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('@acme/review');
      expect(output).toContain('tools: no tool links');
    } finally {
      logSpy.mockRestore();
      tmp.restore();
    }
  });
});

describe('agent interaction', () => {
  beforeEach(() => {
    vi.mocked(isInteractive).mockReturnValue(false);
    checkboxMock.mockReset();
    inputMock.mockReset();
    selectMock.mockReset();
  });

  it('emits version choices through the Agent Interaction protocol', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-version-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-version-home-'));
    const skillDir = path.join(tmpDir, 'my-skill');
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);
      try {
        await run([
          'node',
          'esl',
          'version',
          '-C',
          skillDir,
          '--agent-interaction',
          '--agent-tool',
          'codex'
        ]);
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(process.exitCode).toBe(2);
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{
          question: string;
          header: string;
          options: Array<{ label: string; description?: string }>;
          multiSelect: boolean;
        }>;
      };
      expect(payload.questions).toEqual([
        {
          question: 'Release type',
          header: 'Release type',
          options: [
            { label: 'patch', description: '0.1.1 — 修复缺陷' },
            { label: 'minor', description: '0.2.0 — 兼容的新能力' },
            { label: 'major', description: '1.0.0 — 破坏性变更' }
          ],
          multiSelect: false
        }
      ]);
      expect(selectMock).not.toHaveBeenCalled();
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8')).version).toBe(
        '0.1.0'
      );
    } finally {
      stdoutSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('asks for an explicit version through Agent Interaction for a pre-version manifest', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-version-v1-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-version-v1-home-'));
    const skillDir = path.join(tmpDir, 'old-skill');
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      fs.mkdirSync(skillDir);
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: old-skill\ndescription: Legacy skill.\n---\n'
      );
      fs.writeFileSync(
        path.join(skillDir, 'release.json'),
        JSON.stringify({
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        })
      );
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);
      try {
        await run(['node', 'esl', 'version', '-C', skillDir, '--agent-interaction']);
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(process.exitCode).toBe(2);
      expect(JSON.parse(stdout.join('')).questions).toEqual([
        {
          question: 'Version',
          header: 'Version',
          options: [],
          multiSelect: false
        }
      ]);
    } finally {
      stdoutSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('emits AskUserQuestion-style JSON for Codex', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const targetDir = path.join(tmpDir, 'my-skill');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await run(['node', 'esl', 'init', targetDir, '--agent-interaction', '--agent-tool', 'codex']);

      expect(process.exitCode).toBe(2);
      expect(stderr.join('')).toBe('');
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{
          question: string;
          header: string;
          options: Array<{ label: string; description?: string }>;
          multiSelect: boolean;
        }>;
        metadata?: { source?: string };
      };
      expect(payload.metadata).toEqual({ source: 'esl-cli' });
      expect(payload.questions.map((question) => question.question)).toEqual([
        'Skill description',
        'License',
        'Keywords',
        'Display name',
        'Namespace'
      ]);
      expect(payload.questions[0].options).toEqual([
        { label: expect.stringContaining('Use when'), description: '默认值' }
      ]);
      expect(payload.questions[1].options).toEqual([{ label: 'MIT', description: '默认值' }]);
      expect(payload.questions[2].multiSelect).toBe(true);
      expect(payload.questions[3].multiSelect).toBe(false);
      expect(payload.questions[3].options).toEqual([{ label: 'My Skill', description: '默认值' }]);
      expect(payload.questions[4].options).toEqual([{ label: 'personal', description: '默认值' }]);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('prompts for a version and applies the selected patch bump', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-interactive-'));
    const skillDir = path.join(tmpDir, 'my-skill');

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      vi.mocked(isInteractive).mockReturnValue(true);
      selectMock.mockResolvedValueOnce('patch');
      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);

      try {
        await createProgram().parseAsync(['version', '-C', skillDir], { from: 'user' });
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(selectMock).toHaveBeenCalledOnce();
      expect(selectMock).toHaveBeenCalledWith({
        message: 'Select release type',
        default: 'patch',
        choices: [
          { name: 'patch', value: 'patch', description: '0.1.1 — 修复缺陷' },
          { name: 'minor', value: 'minor', description: '0.2.0 — 兼容的新能力' },
          { name: 'major', value: 'major', description: '1.0.0 — 破坏性变更' },
          { name: 'custom', value: 'custom', description: '输入明确的 SemVer（例如 1.4.2）' }
        ]
      });
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8')).version).toBe(
        '0.1.1'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('applies a custom SemVer entered through the version prompt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-custom-'));
    const skillDir = path.join(tmpDir, 'my-skill');

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      vi.mocked(isInteractive).mockReturnValue(true);
      selectMock.mockResolvedValueOnce('custom');
      inputMock.mockResolvedValueOnce('1.4.2');
      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);

      try {
        await createProgram().parseAsync(['version', '-C', skillDir], { from: 'user' });
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(inputMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Version (SemVer)' }),
        {}
      );
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8')).version).toBe(
        '1.4.2'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('re-prompts until a custom SemVer is valid', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-custom-retry-'));
    const skillDir = path.join(tmpDir, 'my-skill');

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      vi.mocked(isInteractive).mockReturnValue(true);
      selectMock.mockResolvedValueOnce('custom');
      inputMock.mockResolvedValueOnce('not-semver').mockResolvedValueOnce('1.4.2');
      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);

      try {
        await createProgram().parseAsync(['version', '-C', skillDir], { from: 'user' });
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(inputMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8')).version).toBe(
        '1.4.2'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats version prompt cancellation as an interrupt without modifying the skill', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-cancel-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-cancel-home-'));
    const skillDir = path.join(tmpDir, 'my-skill');
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      vi.mocked(isInteractive).mockReturnValue(true);
      const cancellation = new Error('Prompt was canceled');
      cancellation.name = 'ExitPromptError';
      selectMock.mockRejectedValueOnce(cancellation);
      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);

      try {
        await run(['node', 'esl', 'version', '-C', skillDir]);
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(process.exitCode).toBe(130);
      expect(stderr.join('')).toBe('');
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8')).version).toBe(
        '0.1.0'
      );
    } finally {
      stderrSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('preflights the skill before showing the version prompt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-preflight-'));
    const skillDir = path.join(tmpDir, 'my-skill');

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(skillDir, 'scratch.txt'), 'dirty');

      vi.mocked(isInteractive).mockReturnValue(true);
      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);

      try {
        await expect(
          createProgram().parseAsync(['version', '-C', skillDir], { from: 'user' })
        ).rejects.toThrow(/not clean/);
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(selectMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails a bare version command outside a TTY before inspecting the repository', async () => {
    vi.mocked(isInteractive).mockReturnValue(false);

    await expect(createProgram().parseAsync(['version'], { from: 'user' })).rejects.toThrow(
      /Missing release/
    );

    expect(selectMock).not.toHaveBeenCalled();
  });

  it('lets --no-input override Agent Interaction for a bare version command', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);

    await expect(
      createProgram().parseAsync(['version', '--agent-interaction', '--no-input'], { from: 'user' })
    ).rejects.toThrow(/Missing release/);

    expect(selectMock).not.toHaveBeenCalled();
  });

  it('keeps an explicit version argument non-interactive', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-explicit-'));
    const skillDir = path.join(tmpDir, 'my-skill');

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      vi.mocked(isInteractive).mockReturnValue(true);
      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);

      try {
        await createProgram().parseAsync(['version', 'patch', '-C', skillDir], { from: 'user' });
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(selectMock).not.toHaveBeenCalled();
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8')).version).toBe(
        '0.1.1'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('offers only a custom SemVer when the release manifest predates versioning', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-v1-'));
    const skillDir = path.join(tmpDir, 'old-skill');

    try {
      fs.mkdirSync(skillDir);
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: old-skill\ndescription: Legacy skill.\n---\n'
      );
      fs.writeFileSync(
        path.join(skillDir, 'release.json'),
        JSON.stringify({
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        })
      );
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      vi.mocked(isInteractive).mockReturnValue(true);
      selectMock.mockResolvedValueOnce('custom');
      inputMock.mockResolvedValueOnce('2.0.0');
      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);

      try {
        await createProgram().parseAsync(['version', '-C', skillDir], { from: 'user' });
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(selectMock).toHaveBeenCalledWith({
        message: 'Select release type',
        default: 'custom',
        choices: [
          {
            name: 'custom',
            value: 'custom',
            description: '输入明确的 SemVer（例如 1.4.2）'
          }
        ]
      });
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'))).toMatchObject({
        schemaVersion: 4,
        version: '2.0.0'
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts a release version supplied through --params-json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-params-'));
    const skillDir = path.join(tmpDir, 'my-skill');

    try {
      await executeInit({ directory: skillDir, runGitInit: false });
      execSync('git init -b main', { cwd: skillDir, stdio: 'ignore' });
      execSync('git config user.email tester@example.com', { cwd: skillDir });
      execSync('git config user.name "Tester"', { cwd: skillDir });
      execSync('git add -A && git commit -m "init"', { cwd: skillDir, stdio: 'ignore' });

      const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(skillDir);
      try {
        await createProgram().parseAsync(
          ['version', '-C', skillDir, '--params-json', '{"release":"patch"}'],
          { from: 'user' }
        );
      } finally {
        chdirSpy.mockRestore();
        cwdSpy.mockRestore();
      }

      expect(selectMock).not.toHaveBeenCalled();
      expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8')).version).toBe(
        '0.1.1'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects a release supplied both positionally and through --params-json', async () => {
    await expect(
      createProgram().parseAsync(
        ['version', 'patch', '--params-json', '{"release":"minor"}'],
        { from: 'user' }
      )
    ).rejects.toThrow(/release cannot be passed both as a flag and in --params-json/);
  });

  it('emits AskUserQuestion-style JSON for claude-code', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const targetDir = path.join(tmpDir, 'my-skill');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await run(['node', 'esl', 'init', targetDir, '--agent-interaction', '--agent-tool', 'claude-code']);

      expect(process.exitCode).toBe(2);
      expect(stderr.join('')).toBe('');
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{
          question: string;
          header: string;
          options: Array<{ label: string; description?: string }>;
          multiSelect: boolean;
        }>;
        metadata?: { source?: string };
      };
      expect(payload.metadata).toEqual({ source: 'esl-cli' });
      expect(payload.questions.map((question) => question.question)).toEqual([
        'Skill description',
        'License',
        'Keywords',
        'Display name',
        'Namespace'
      ]);
      expect(payload.questions[0].multiSelect).toBe(false);
      expect(payload.questions[0].options).toEqual([
        { label: expect.stringContaining('Use when'), description: '默认值' }
      ]);
      expect(payload.questions[1].options).toEqual([{ label: 'MIT', description: '默认值' }]);
      expect(payload.questions[2].multiSelect).toBe(true);
      expect(payload.questions[2].options).toEqual([]);
      expect(payload.questions[3].multiSelect).toBe(false);
      expect(payload.questions[3].options).toEqual([{ label: 'My Skill', description: '默认值' }]);
      expect(payload.questions[4].multiSelect).toBe(false);
      expect(payload.questions[4].options).toEqual([{ label: 'personal', description: '默认值' }]);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('emits AskUserQuestion-style JSON without --agent-tool', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await run(['node', 'esl', 'init', path.join(tmpDir, 'my-skill'), '--agent-interaction']);

      expect(process.exitCode).toBe(2);
      expect(stderr.join('')).toBe('');
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{ question: string }>;
        metadata?: { source?: string };
      };
      expect(payload.metadata).toEqual({ source: 'esl-cli' });
      expect(payload.questions.map((question) => question.question)).toEqual([
        'Skill description',
        'License',
        'Keywords',
        'Display name',
        'Namespace'
      ]);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('rejects --agent-tool without --agent-interaction', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await run(['node', 'esl', 'init', path.join(tmpDir, 'my-skill'), '--agent-tool', 'claude']);

      expect(process.exitCode).toBe(1);
      expect(stderr.join('')).toContain('--agent-tool requires --agent-interaction');
      expect(fs.existsSync(path.join(tmpDir, 'my-skill'))).toBe(false);
    } finally {
      stderrSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown --agent-tool value', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await run([
        'node',
        'esl',
        'init',
        path.join(tmpDir, 'my-skill'),
        '--agent-interaction',
        '--agent-tool',
        'unknown'
      ]);

      expect(process.exitCode).toBe(1);
      expect(stderr.join('')).toContain('Unknown agent tool: unknown');
      expect(fs.existsSync(path.join(tmpDir, 'my-skill'))).toBe(false);
    } finally {
      stderrSpy.mockRestore();
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('completes init from --params-json without prompting', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const targetDir = path.join(tmpDir, 'my-skill');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    process.exitCode = undefined;

    try {
      await run([
        'node',
        'esl',
        'init',
        targetDir,
        '--params-json',
        JSON.stringify({
          description: 'Review code changes carefully.',
          license: 'Apache-2.0',
          keywords: ['review', 'code'],
          namespace: 'personal'
        })
      ]);

      expect(process.exitCode).toBeFalsy();
      expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'release.json'), 'utf8'))).toMatchObject({
        name: 'my-skill',
        license: 'Apache-2.0',
        keywords: ['review', 'code']
      });
      expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain(
        'description: Review code changes carefully.'
      );
    } finally {
      homedirSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('rejects a parameter supplied both as a flag and in --params-json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    process.exitCode = undefined;

    try {
      await run([
        'node',
        'esl',
        'init',
        path.join(tmpDir, 'my-skill'),
        '--license',
        'MIT',
        '--params-json',
        '{"license":"Apache-2.0"}'
      ]);

      expect(process.exitCode).toBe(1);
      expect(stderr.join('')).toContain('license cannot be passed both as a flag and in --params-json');
      expect(fs.existsSync(path.join(tmpDir, 'my-skill'))).toBe(false);
    } finally {
      stderrSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects unknown --params-json fields as an ordinary failure', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    process.exitCode = undefined;

    try {
      await run([
        'node',
        'esl',
        'init',
        path.join(tmpDir, 'my-skill'),
        '--params-json',
        '{"unknown":true}'
      ]);

      expect(process.exitCode).toBe(1);
      expect(stderr.join('')).toContain('unknown parameter unknown');
    } finally {
      stderrSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed --params-json as an ordinary failure', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    process.exitCode = undefined;

    try {
      await run(['node', 'esl', 'init', path.join(tmpDir, 'my-skill'), '--params-json', '{']);

      expect(process.exitCode).toBe(1);
      expect(stderr.join('')).toContain('expected valid JSON');
    } finally {
      stderrSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects --params-json on commands that have not adopted the protocol', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-init-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-agent-home-'));
    const targetDir = path.join(tmpDir, 'my-skill');
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    process.exitCode = undefined;

    try {
      await executeInit({ directory: targetDir, runGitInit: false, homeDir });
      await run(['node', 'esl', 'validate', targetDir, '--params-json', '{}']);

      expect(process.exitCode).toBe(1);
      expect(stderr.join('')).toContain('--params-json is not supported for validate');
    } finally {
      stderrSpy.mockRestore();
      process.exitCode = undefined;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe('upload / publish positional path', () => {
  function uploadedResult() {
    return { name: '@ns/reviewer', skillId: 'sk_01', cloneUrl: 'http://localhost:3000/git/ns/reviewer.git' };
  }

  beforeEach(() => {
    vi.mocked(executeUpload).mockReset();
    vi.mocked(executePublish).mockReset();
    vi.mocked(executeUpload).mockResolvedValue(uploadedResult());
    vi.mocked(executePublish).mockResolvedValue({});
  });

  it('registers only the optional path positional on upload and publish', () => {
    const program = createProgram();
    const upload = program.commands.find((command) => command.name() === 'upload');
    const publish = program.commands.find((command) => command.name() === 'publish');

    expect(upload?.registeredArguments.map((argument) => `${argument.name()}:${argument.required}`)).toEqual(['path:false']);
    expect(publish?.registeredArguments.map((argument) => `${argument.name()}:${argument.required}`)).toEqual([
      'path:false'
    ]);
  });

  it('passes the upload positional path as the directory', async () => {
    const program = createProgram();
    await program.parseAsync(['upload', './markdown-master'], { from: 'user' });

    expect(executeUpload).toHaveBeenCalledWith(expect.objectContaining({ directory: './markdown-master' }));
  });

  it('registers only the skill directory positional on init and no skill-name argument', () => {
    const program = createProgram();
    const init = program.commands.find((command) => command.name() === 'init');

    expect(init?.registeredArguments.map((argument) => `${argument.name()}:${argument.required}`)).toEqual([
      'path:false'
    ]);
    expect(init?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--name', '--license', '--description', '--keywords'])
    );
  });

  it('rejects the removed --directory option on directory-taking commands', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let rejectedWithUnknownOption = false;
    try {
      const program = createProgram();
      try {
        await program.parseAsync(['upload', '--directory', './b'], { from: 'user' });
      } catch {
        // commander exits the process on an unknown option; reaching the assertions below is enough.
      }

      rejectedWithUnknownOption =
        stderrSpy.mock.calls.some((args) => String(args[0]).includes('unknown option')) &&
        exitSpy.mock.calls.some((args) => args[0] === 1);
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
    expect(rejectedWithUnknownOption).toBe(true);
  });

  it('falls back to the current directory for upload when no path is given', async () => {
    const program = createProgram();
    await program.parseAsync(['upload'], { from: 'user' });

    const firstCall = vi.mocked(executeUpload).mock.calls[0];
    expect((firstCall?.[0] as { directory?: string }).directory).toBeUndefined();
  });

  it('chdirs from the global -C option before running the command', async () => {
    const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
    try {
      const program = createProgram();
      await program.parseAsync(['upload', '-C', './somewhere'], { from: 'user' });

      expect(chdirSpy).toHaveBeenCalledWith('./somewhere');
      const firstCall = vi.mocked(executeUpload).mock.calls[0];
      expect((firstCall?.[0] as { directory?: string }).directory).toBeUndefined();
    } finally {
      chdirSpy.mockRestore();
    }
  });

  it('passes the publish positional path as the directory', async () => {
    const program = createProgram();
    await program.parseAsync(['publish', './x'], { from: 'user' });

    expect(executePublish).toHaveBeenCalledWith(expect.objectContaining({ directory: './x' }));
  });

  it('treats a bare version argument as a mistake and points at esl version', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
    const program = createProgram();

    await program.parseAsync(['publish', '1.0.0'], { from: 'user' });

    expect(executePublish).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('esl version'));
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });
});

describe('consumer project root discovery (bin)', () => {
  let root: string;
  let homeDir: string;
  let originalCwd: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  function writeSkill(directory: string): void {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      '---\nname: draft-skill\ndescription: Test skill.\n---\n\n# Draft\n'
    );
  }

  beforeEach(() => {
    originalCwd = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-bin-cpr-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-bin-cpr-home-'));
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    vi.mocked(isInteractive).mockReturnValue(false);
    vi.mocked(resolveLinkIdentity).mockReset();
    vi.mocked(executeLink).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    homedirSpy.mockRestore();
    process.exitCode = undefined;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('links into the parent project store silently under --no-input with hard evidence', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    fs.writeFileSync(path.join(root, '.skills.json'), '{"skills":{}}\n');
    process.chdir(path.join(root, 'draft-skill'));
    vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@local/draft-skill' });
    vi.mocked(executeLink).mockResolvedValueOnce('/tmp/linked');

    const program = createProgram();
    await program.parseAsync(['link', '--no-input', '--no-tools'], { from: 'user' });

    expect(executeLink).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({ projectRoot: root, global: false })
    );
  });

  it('fails under --no-input when the parent has only weak evidence', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    fs.mkdirSync(path.join(root, '.codex'));
    process.chdir(path.join(root, 'draft-skill'));
    vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@local/draft-skill' });

    const program = createProgram();
    await expect(
      program.parseAsync(['link', '--no-input', '--no-tools'], { from: 'user' })
    ).rejects.toThrow(/best-effort|confirm|--global|Consumer Project Root/i);
    expect(executeLink).not.toHaveBeenCalled();
  });

  it('does not write a parent store when the identity cannot be resolved', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    process.chdir(path.join(root, 'draft-skill'));
    vi.mocked(resolveLinkIdentity).mockRejectedValueOnce(new Error('Skill source requires SKILL.md'));

    const program = createProgram();
    await expect(
      program.parseAsync(['link', '--no-input', '--no-tools'], { from: 'user' })
    ).rejects.toThrow(/SKILL\.md/);
    expect(fs.existsSync(path.join(root, '.skills.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.eslib'))).toBe(false);
  });

  it('asks the agent to confirm weak evidence and shows the tool directories', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    fs.mkdirSync(path.join(root, '.codex'));
    fs.mkdirSync(path.join(root, '.cursor'));
    process.chdir(path.join(root, 'draft-skill'));
    vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@local/draft-skill' });
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });

    try {
      await run(['node', 'esl', 'link', '--agent-interaction', '--no-tools']);

      expect(process.exitCode).toBe(2);
      expect(executeLink).not.toHaveBeenCalled();
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{ question: string; multiSelect: boolean; options: Array<{ label: string }> }>;
      };
      expect(payload.questions).toHaveLength(1);
      expect(payload.questions[0].question).toContain('.codex');
      expect(payload.questions[0].question).toContain('.cursor');
      expect(payload.questions[0].multiSelect).toBe(false);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('asks the agent to choose a project root when there is no evidence', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    // unlink resolves identity from release.json; give the skill one.
    fs.writeFileSync(
      path.join(root, 'draft-skill', 'release.json'),
      JSON.stringify({
        schemaVersion: 3,
        name: '@local/draft-skill',
        version: '0.2.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );
    process.chdir(path.join(root, 'draft-skill'));
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });

    try {
      await run(['node', 'esl', 'unlink', '--agent-interaction']);

      expect(process.exitCode).toBe(2);
      const payload = JSON.parse(stdout.join('')) as {
        questions: Array<{ question: string; options: Array<{ label: string; description?: string }> }>;
      };
      expect(payload.questions[0].question).toContain('Consumer Project Root');
      expect(payload.questions[0].options.map((option) => option.description)).toEqual(
        expect.arrayContaining(['choice: init', 'choice: directory', 'choice: global'])
      );
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('completes an agent link rerun with --params-json useParent', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    fs.mkdirSync(path.join(root, '.trae'));
    process.chdir(path.join(root, 'draft-skill'));
    vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@local/draft-skill' });
    vi.mocked(executeLink).mockResolvedValueOnce('/tmp/linked');

    await run([
      'node',
      'esl',
      'link',
      '--agent-interaction',
      '--no-tools',
      '--params-json',
      '{"useParent":true}'
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(executeLink).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({ projectRoot: root, global: false })
    );
  });

  it('hints the parent project root for list inside a skill directory', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    fs.writeFileSync(path.join(root, '.skills.json'), '{"skills":{}}\n');
    process.chdir(path.join(root, 'draft-skill'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const program = createProgram();
      await program.parseAsync(['list', '--no-input'], { from: 'user' });

      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain(root);
      expect(output).toContain('-C');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('chdirs with the global -C before judging the new cwd', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    fs.writeFileSync(path.join(root, '.skills.json'), '{"skills":{}}\n');
    vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@local/draft-skill' });
    vi.mocked(executeLink).mockResolvedValueOnce('/tmp/linked');

    const program = createProgram();
    await program.parseAsync(
      ['link', '-C', path.join(root, 'draft-skill'), '--no-input', '--no-tools'],
      { from: 'user' }
    );

    expect(executeLink).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({ projectRoot: root, global: false })
    );
  });

  it('initializes the parent during an agent rerun that chooses init', async () => {
    writeSkill(path.join(root, 'draft-skill'));
    fs.mkdirSync(path.join(root, '.claude'));
    process.chdir(path.join(root, 'draft-skill'));
    vi.mocked(resolveLinkIdentity).mockResolvedValue({ identity: '@local/draft-skill' });
    vi.mocked(executeLink).mockResolvedValueOnce('/tmp/linked');
    const program = createProgram();

    await program.parseAsync(
      [
        'link',
        '--agent-interaction',
        '--no-tools',
        '--params-json',
        '{"useParent":false,"projectRootChoice":"init"}'
      ],
      { from: 'user' }
    );

    expect(fs.existsSync(path.join(root, '.skills.json'))).toBe(true);
    expect(executeLink).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({ projectRoot: root, global: false })
    );
  });
});
