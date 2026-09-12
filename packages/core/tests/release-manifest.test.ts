import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMinimalReleaseManifest,
  validateReleaseManifest,
  validateSkillSourceDirectory
} from '../src/index.js';

describe('Release Manifest', () => {
  it('accepts a source directory without skill.json', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-source-'));
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      '---\nname: reviewer\ndescription: Review code\n---\n\n# Reviewer\n'
    );
    fs.writeFileSync(
      path.join(directory, 'release.json'),
      JSON.stringify({
        schemaVersion: 2,
        version: '0.1.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );

    const result = await validateSkillSourceDirectory(directory);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.releaseManifest.license).toBe('MIT');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('reads the released version from the source release manifest', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-source-'));
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      '---\nname: reviewer\ndescription: Review code\n---\n\n# Reviewer\n'
    );
    fs.writeFileSync(
      path.join(directory, 'release.json'),
      JSON.stringify({
        schemaVersion: 2,
        version: '1.4.2',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );

    const result = await validateSkillSourceDirectory(directory);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.releaseManifest.version).toBe('1.4.2');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('points a pre-version release manifest at esl version', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-source-'));
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      '---\nname: reviewer\ndescription: Review code\n---\n\n# Reviewer\n'
    );
    fs.writeFileSync(
      path.join(directory, 'release.json'),
      JSON.stringify({
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );

    const result = await validateSkillSourceDirectory(directory);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join('\n')).toContain('esl version');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('rejects a release manifest without required fields', () => {
    const result = validateReleaseManifest({ schemaVersion: 1, license: 'MIT' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join('\n')).toContain('keywords');
      expect(result.errors.join('\n')).toContain('compatibility');
      expect(result.errors.join('\n')).toContain('dependencies');
    }
  });

  it('rejects a release manifest without a version', () => {
    const result = validateReleaseManifest({
      schemaVersion: 2,
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join('\n')).toContain('version');
    }
  });

  it('rejects a version carrying build metadata', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-source-'));
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      '---\nname: reviewer\ndescription: Review code\n---\n\n# Reviewer\n'
    );
    fs.writeFileSync(
      path.join(directory, 'release.json'),
      JSON.stringify({
        schemaVersion: 2,
        version: '1.0.0+build.7',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );

    const result = await validateSkillSourceDirectory(directory);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join('\n')).toContain('version');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('rejects non-SPDX license expressions', () => {
    const result = validateReleaseManifest({
      schemaVersion: 2,
      version: '0.1.0',
      license: 'not-a-license',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join('\n')).toContain('license');
    }
  });

  it('builds a minimal release manifest that passes validation', () => {
    const manifest = createMinimalReleaseManifest('MIT');

    expect(manifest).toEqual({
      schemaVersion: 2,
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });
    expect(validateReleaseManifest(manifest).success).toBe(true);
  });
});
