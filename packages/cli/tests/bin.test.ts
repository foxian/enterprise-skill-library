import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram, formatErrorMessage, isDirectCliEntry } from '../src/bin/esl.js';
import { executeUpload } from '../src/commands/upload.js';
import { executePublish } from '../src/commands/publish.js';
import { readCliVersion } from '../src/version.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

vi.mock('../src/commands/upload.js', () => ({ executeUpload: vi.fn() }));
vi.mock('../src/commands/publish.js', () => ({ executePublish: vi.fn() }));

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

  it('registers the adapt prune option', () => {
    const program = createProgram();
    const adaptCommand = program.commands.find((command) => command.name() === 'adapt');

    expect(adaptCommand?.options.map((option) => option.long)).toEqual(expect.arrayContaining(['--prune']));
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

  it('registers the optional positional arguments on upload and publish', () => {
    const program = createProgram();
    const upload = program.commands.find((command) => command.name() === 'upload');
    const publish = program.commands.find((command) => command.name() === 'publish');

    expect(upload?.registeredArguments.map((argument) => `${argument.name()}:${argument.required}`)).toEqual(['path:false']);
    expect(publish?.registeredArguments.map((argument) => `${argument.name()}:${argument.required}`)).toEqual([
      'path:false',
      'version:false'
    ]);
  });

  it('passes the upload positional path as the directory', async () => {
    const program = createProgram();
    await program.parseAsync(['upload', './markdown-master'], { from: 'user' });

    expect(executeUpload).toHaveBeenCalledWith(expect.objectContaining({ directory: './markdown-master' }));
  });

  it('prefers the upload positional path over --directory', async () => {
    const program = createProgram();
    await program.parseAsync(['upload', './a', '--directory', './b'], { from: 'user' });

    expect(executeUpload).toHaveBeenCalledWith(expect.objectContaining({ directory: './a' }));
  });

  it('falls back to the current directory for upload when no path is given', async () => {
    const program = createProgram();
    await program.parseAsync(['upload'], { from: 'user' });

    expect(executeUpload).toHaveBeenCalledWith(expect.objectContaining({ directory: process.cwd() }));
  });

  it('resolves publish positional path and version in path-first order', async () => {
    const program = createProgram();
    await program.parseAsync(['publish', './x', '1.0.0'], { from: 'user' });

    expect(executePublish).toHaveBeenCalledWith(expect.objectContaining({ directory: './x', version: '1.0.0' }));
  });

  it('keeps "esl publish <version>" backward compatible', async () => {
    const program = createProgram();
    await program.parseAsync(['publish', '1.0.0'], { from: 'user' });

    expect(executePublish).toHaveBeenCalledWith(
      expect.objectContaining({ version: '1.0.0', directory: process.cwd() })
    );
  });

  it('resolves publish positional path and version in version-first order', async () => {
    const program = createProgram();
    await program.parseAsync(['publish', '1.0.0', './x'], { from: 'user' });

    expect(executePublish).toHaveBeenCalledWith(expect.objectContaining({ directory: './x', version: '1.0.0' }));
  });

  it('accepts a publish path as the only positional argument', async () => {
    const program = createProgram();
    await program.parseAsync(['publish', './x'], { from: 'user' });

    expect(executePublish).toHaveBeenCalledWith(expect.objectContaining({ directory: './x', version: undefined }));
  });
});
