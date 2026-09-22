import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram, formatErrorMessage, isDirectCliEntry, promptToolSelection, run } from '../src/bin/esl.js';
import { executeInstall, resolveDefaultInstallTools } from '../src/commands/install.js';
import { executeInit } from '../src/commands/init.js';
import { executeLink } from '../src/commands/link.js';
import { SUPPORTED_TOOLS } from '@esl/core';
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
vi.mock('../src/commands/link.js', () => ({ executeLink: vi.fn() }));
vi.mock('../src/commands/tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/tools.js')>();
  return { ...actual, executeToolsRemove: vi.fn() };
});
vi.mock('../src/commands/install.js', () => ({
  executeInstall: vi.fn(),
  resolveDefaultInstallTools: vi.fn()
}));

describe('esl program', () => {
  beforeEach(() => {
    vi.mocked(isInteractive).mockReturnValue(false);
    checkboxMock.mockReset();
    confirmMock.mockReset();
    executeSearchMock.mockReset();
    inputMock.mockReset();
    selectMock.mockReset();
    vi.mocked(executeInstall).mockReset();
    vi.mocked(resolveDefaultInstallTools).mockReset();
  });

  it('returns the tools selected from the checkbox prompt', async () => {
    const selectTools = vi.fn().mockResolvedValue(['claude', 'codex']);

    await expect(promptToolSelection(selectTools)).resolves.toEqual(['claude', 'codex']);
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
        'adapt',
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
    vi.mocked(isInteractive).mockReturnValue(true);
    vi.mocked(resolveDefaultInstallTools).mockResolvedValueOnce([]);
    vi.mocked(executeInstall).mockClear();
    const program = createProgram();

    await expect(
      program.parseAsync(['install', '@acme/review', '--no-input'], { from: 'user' })
    ).rejects.toThrow('No tools configured');

    expect(checkboxMock).not.toHaveBeenCalled();
    expect(executeInstall).not.toHaveBeenCalled();
  });

  it('does not prompt for link under --no-input', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    vi.mocked(resolveDefaultInstallTools).mockResolvedValueOnce([]);
    vi.mocked(executeLink).mockClear();
    const program = createProgram();

    await expect(
      program.parseAsync(['link', './my-skill', '--no-input'], { from: 'user' })
    ).rejects.toThrow('No tools configured');

    expect(checkboxMock).not.toHaveBeenCalled();
    expect(executeLink).not.toHaveBeenCalled();
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

  it('reports the CLI version from the package manifest', () => {
    expect(readCliVersion()).toBe('0.1.0');
    const program = createProgram();
    expect(program.version()).toBe('0.1.0');
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

  it('detects direct execution from Windows paths', () => {
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
        'Namespace'
      ]);
      expect(payload.questions[0].options).toEqual([
        { label: expect.stringContaining('Use when'), description: '默认值' }
      ]);
      expect(payload.questions[1].options).toEqual([{ label: 'MIT', description: '默认值' }]);
      expect(payload.questions[2].multiSelect).toBe(true);
      expect(payload.questions[3].options).toEqual([{ label: 'personal', description: '默认值' }]);
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
        schemaVersion: 3,
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
      expect(payload.questions[3].options).toEqual([{ label: 'personal', description: '默认值' }]);
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
