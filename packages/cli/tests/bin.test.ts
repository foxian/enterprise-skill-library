import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram, formatErrorMessage, isDirectCliEntry, run } from '../src/bin/esl.js';
import { executeInstall, resolveDefaultInstallTools } from '../src/commands/install.js';
import { executeInit } from '../src/commands/init.js';
import { SUPPORTED_TOOLS } from '@esl/core';
import { executeUpload } from '../src/commands/upload.js';
import { executePublish } from '../src/commands/publish.js';
import { readCliVersion } from '../src/version.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

vi.mock('../src/commands/upload.js', () => ({ executeUpload: vi.fn() }));
vi.mock('../src/commands/publish.js', () => ({ executePublish: vi.fn() }));
vi.mock('../src/commands/install.js', () => ({
  executeInstall: vi.fn(),
  resolveDefaultInstallTools: vi.fn()
}));

describe('esl program', () => {
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
  it('returns a structured init request with exit code 2 when input is missing', async () => {
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
      await run(['node', 'esl', 'init', targetDir, '--agent-interaction']);

      expect(process.exitCode).toBe(2);
      expect(stderr.join('')).toBe('');
      expect(JSON.parse(stdout.join(''))).toEqual({
        type: 'esl.interaction.request',
        schemaVersion: 1,
        requestId: expect.stringMatching(/^ir_/),
        command: 'init',
        fields: [
          {
            id: 'description',
            kind: 'text',
            label: 'Skill description',
            required: true,
            default: expect.stringContaining('Use when')
          },
          {
            id: 'license',
            kind: 'text',
            label: 'License',
            required: true,
            default: 'MIT'
          },
          {
            id: 'keywords',
            kind: 'multiselect',
            label: 'Keywords',
            required: false,
            default: []
          },
          {
            id: 'namespace',
            kind: 'text',
            label: 'Namespace',
            required: true,
            default: 'personal'
          }
        ]
      });
    } finally {
      stdoutSpy.mockRestore();
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
