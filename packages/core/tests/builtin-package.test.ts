import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBuiltinPackage,
  loadBuiltinPackage,
  isBuiltinIdentity
} from '../src/skill/builtin-package.js';

describe('builtin skill package', () => {
  let tmpDir: string;
  let sourceDir: string;
  let outputRoot: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-builtin-'));
    sourceDir = path.join(tmpDir, 'esl-operator');
    outputRoot = path.join(tmpDir, 'builtin');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: esl-operator\ndescription: Operate the ESL CLI.\n---\n\n# ESL operator\n'
    );
    await fs.mkdir(path.join(sourceDir, 'references'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'references', 'setup.md'), '# Setup\n');
    await fs.mkdir(path.join(sourceDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'assets', 'logo.png'), 'png-bytes');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('recognises builtin scope identities', () => {
    expect(isBuiltinIdentity('@builtin/esl-operator')).toBe(true);
    expect(isBuiltinIdentity('@cnfox/code-review')).toBe(false);
    expect(isBuiltinIdentity('@local/my-draft')).toBe(false);
  });

  it('builds a built-in package with the CLI version and a checksum manifest', async () => {
    const built = await buildBuiltinPackage({
      sourceDir,
      outputRoot,
      identity: '@builtin/esl-operator',
      cliVersion: '1.0.0-rc.1'
    });

    expect(built.name).toBe('@builtin/esl-operator');
    expect(built.version).toBe('1.0.0-rc.1');

    const packageDir = path.join(outputRoot, 'esl-operator');
    const skillJson = JSON.parse(await fs.readFile(path.join(packageDir, 'skill.json'), 'utf8'));
    expect(skillJson.name).toBe('@builtin/esl-operator');
    expect(skillJson.version).toBe('1.0.0-rc.1');
    expect(skillJson.description).toBe('Operate the ESL CLI.');
    expect(await fs.readFile(path.join(packageDir, 'SKILL.md'), 'utf8')).toContain('# ESL operator');
    expect(await fs.readFile(path.join(packageDir, 'references', 'setup.md'), 'utf8')).toBe('# Setup\n');
    expect(await fs.readFile(path.join(packageDir, 'assets', 'logo.png'), 'utf8')).toBe('png-bytes');

    const manifest = JSON.parse(await fs.readFile(path.join(outputRoot, 'builtin-packages.json'), 'utf8'));
    expect(manifest.packages['@builtin/esl-operator']).toEqual({
      name: '@builtin/esl-operator',
      version: '1.0.0-rc.1',
      checksum: built.checksum,
      shortName: 'esl-operator'
    });
  });

  it('rejects a build whose CLI version is not a valid SemVer', async () => {
    await expect(
      buildBuiltinPackage({
        sourceDir,
        outputRoot,
        identity: '@builtin/esl-operator',
        cliVersion: 'not-a-version'
      })
    ).rejects.toThrow('version');
  });

  it('loads a built-in package from a built output root', async () => {
    const built = await buildBuiltinPackage({
      sourceDir,
      outputRoot,
      identity: '@builtin/esl-operator',
      cliVersion: '0.1.0'
    });

    const loaded = await loadBuiltinPackage(outputRoot, '@builtin/esl-operator');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('@builtin/esl-operator');
    expect(loaded!.version).toBe('0.1.0');
    expect(loaded!.checksum).toBe(built.checksum);
    expect(loaded!.directory).toBe(path.join(outputRoot, 'esl-operator'));
  });

  it('returns null for an unknown built-in identity', async () => {
    await buildBuiltinPackage({
      sourceDir,
      outputRoot,
      identity: '@builtin/esl-operator',
      cliVersion: '0.1.0'
    });

    expect(await loadBuiltinPackage(outputRoot, '@builtin/unknown')).toBeNull();
  });

  it('detects content corruption via the checksum', async () => {
    const built = await buildBuiltinPackage({
      sourceDir,
      outputRoot,
      identity: '@builtin/esl-operator',
      cliVersion: '0.1.0'
    });

    await fs.writeFile(path.join(outputRoot, 'esl-operator', 'SKILL.md'), '---\nname: tampered\n---\n');
    await expect(loadBuiltinPackage(outputRoot, '@builtin/esl-operator')).rejects.toThrow('checksum');
    expect(built.checksum).toBeTruthy();
  });
});