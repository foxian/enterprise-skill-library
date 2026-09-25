import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveUnlinkIdentity } from '../src/commands/resolve-unlink-identity.js';

function writeRelease(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'release.json'),
    JSON.stringify({
      schemaVersion: 3,
      name,
      version: '1.0.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    })
  );
}

describe('resolveUnlinkIdentity', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-unlink-resolve-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('treats @scope/name as an explicit identity', async () => {
    await expect(resolveUnlinkIdentity('@forg/markdown-master', { cwd: root })).resolves.toEqual({
      identity: '@forg/markdown-master',
      fromDirectory: false,
      skillDir: null,
      usedOmitOrDot: false
    });
  });

  it('reads release.json from cwd when target is omitted', async () => {
    writeRelease(root, '@forg/markdown-master');
    await expect(resolveUnlinkIdentity(undefined, { cwd: root })).resolves.toMatchObject({
      identity: '@forg/markdown-master',
      fromDirectory: true,
      skillDir: path.resolve(root),
      usedOmitOrDot: true
    });
  });

  it('treats "." like an omitted target', async () => {
    writeRelease(root, '@forg/markdown-master');
    await expect(resolveUnlinkIdentity('.', { cwd: root })).resolves.toMatchObject({
      identity: '@forg/markdown-master',
      usedOmitOrDot: true,
      fromDirectory: true
    });
  });

  it('reads release.json from an explicit relative path without changing semantic cwd', async () => {
    const skillDir = path.join(root, 'skills', 'markdown-master');
    writeRelease(skillDir, '@forg/markdown-master');
    await expect(resolveUnlinkIdentity('./skills/markdown-master', { cwd: root })).resolves.toMatchObject({
      identity: '@forg/markdown-master',
      fromDirectory: true,
      skillDir: path.resolve(skillDir),
      usedOmitOrDot: false
    });
  });

  it('completes a bare release.json name as @local/<short-name>', async () => {
    writeRelease(root, 'draft-skill');
    await expect(resolveUnlinkIdentity(undefined, { cwd: root })).resolves.toMatchObject({
      identity: '@local/draft-skill'
    });
  });

  it('rejects a non-@ token that is not a usable skill directory', async () => {
    await expect(resolveUnlinkIdentity('markdown-master', { cwd: root })).rejects.toThrow(
      /release\.json|skill directory|@scope\/skill-name/i
    );
  });
});
