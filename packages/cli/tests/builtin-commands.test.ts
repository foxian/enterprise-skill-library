import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinPackage, initializeLocalStore, saveConfig } from '@esl/core';
import { executeUse } from '../src/commands/use.js';
import { executeInfo } from '../src/commands/info.js';
import { executePublish } from '../src/commands/publish.js';
import { executeUpload } from '../src/commands/upload.js';
import { executeSource } from '../src/commands/source.js';
import { executeRename } from '../src/commands/rename.js';
import { executeVersion } from '../src/commands/version.js';
import { executeSearch } from '../src/commands/search.js';

describe('built-in readonly commands and forbiddance', () => {
  let homeDir: string;
  let builtinRoot: string;
  let sourceDir: string;
  let builtinNamedDir: string;
  let builtinNamedParent: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-cmd-home-'));
    builtinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-cmd-pkgs-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });

    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-cmd-src-'));
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: esl-operator\ndescription: Operate the ESL CLI.\n---\n\n# ESL operator\n'
    );
    await buildBuiltinPackage({
      sourceDir,
      outputRoot: builtinRoot,
      identity: '@builtin/esl-operator',
      cliVersion: '0.1.0'
    });

    builtinNamedParent = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-cmd-'));
    builtinNamedDir = path.join(builtinNamedParent, 'esl-operator');
    fs.mkdirSync(builtinNamedDir, { recursive: true });
    fs.writeFileSync(
      path.join(builtinNamedDir, 'skill.json'),
      JSON.stringify({
        name: '@builtin/esl-operator',
        version: '0.1.0',
        description: 'Operate the ESL CLI.',
        author: '@esl/cli'
      })
    );
    fs.writeFileSync(
      path.join(builtinNamedDir, 'SKILL.md'),
      '---\nname: esl-operator\ndescription: Operate the ESL CLI.\n---\n\n# ESL operator\n'
    );
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(builtinRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(builtinNamedParent, { recursive: true, force: true });
  });

  it('prints the built-in skill prompt via esl use without login', async () => {
    const content = await executeUse('@builtin/esl-operator', { homeDir, builtinDir: builtinRoot });
    expect(content).toContain('# ESL operator');
    expect(content).toContain('name: esl-operator');
  });

  it('shows built-in metadata via esl info without login', async () => {
    const info = await executeInfo('@builtin/esl-operator', { homeDir, builtinDir: builtinRoot });
    expect(info.name).toBe('@builtin/esl-operator');
    expect(info.versions).toEqual(['0.1.0']);
    expect(info.description).toBe('Operate the ESL CLI.');
  });

  it('rejects use of an unknown built-in identity', async () => {
    await expect(
      executeUse('@builtin/does-not-exist', { homeDir, builtinDir: builtinRoot })
    ).rejects.toThrow('Unknown built-in skill');
  });

  it('rejects publish of a built-in identity', async () => {
    await expect(
      executePublish({ homeDir, builtinDir: builtinRoot, directory: builtinNamedDir })
    ).rejects.toThrow('cannot be published');
  });

  it('rejects upload of a built-in identity', async () => {
    await expect(
      executeUpload({ homeDir, builtinDir: builtinRoot, directory: builtinNamedDir })
    ).rejects.toThrow('cannot be uploaded');
  });

  it('rejects version of a built-in skill directory', async () => {
    await expect(
      executeVersion('minor', { cwd: builtinNamedDir })
    ).rejects.toThrow('cannot be versioned');
  });

  it('filters built-in identities out of search results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { name: '@cnfox/code-review', description: 'Review code' },
        { name: '@builtin/esl-operator', description: 'Operate the ESL CLI' }
      ]
    });

    const results = await executeSearch('esl', {
      homeDir,
      builtinDir: builtinRoot,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });

    expect(results).toEqual([
      { name: '@cnfox/code-review', description: 'Review code' }
    ]);
  });

  it('rejects source of a built-in identity', async () => {
    await expect(
      executeSource('@builtin/esl-operator', { homeDir, builtinDir: builtinRoot })
    ).rejects.toThrow('Unknown built-in');
  });

  it('rejects rename of a built-in identity', async () => {
    const fetchImpl = vi.fn();
    await expect(
      executeRename('@builtin/esl-operator', {
        newName: '@builtin/other',
        homeDir,
        builtinDir: builtinRoot,
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow('Unknown built-in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});