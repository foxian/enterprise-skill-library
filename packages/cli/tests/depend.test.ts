import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInit } from '../src/commands/init.js';
import {
  executeDependAdd,
  executeDependList,
  executeDependRemove,
  formatDependList
} from '../src/commands/depend.js';

describe('esl depend', () => {
  let tmpDir: string;
  let skillDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-depend-'));
    skillDir = path.join(tmpDir, 'my-skill');
    await executeInit({ directory: skillDir, runGitInit: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const readReleaseJson = () =>
    JSON.parse(fs.readFileSync(path.join(skillDir, 'release.json'), 'utf8'));

  const infoFetch = (versions: string[]) =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/base', versions })
    });

  it('add defaults the range to ^highest stable, ignoring prereleases', async () => {
    const fetchImpl = infoFetch(['2.0.0-beta.1', '1.2.0', '1.0.0']);

    const result = await executeDependAdd('@acme/base', {
      directory: skillDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });

    expect(result).toMatchObject({ identity: '@acme/base', range: '^1.2.0', updated: false });
    expect(readReleaseJson().dependencies['@acme/base']).toBe('^1.2.0');
  });

  it('add writes the given range and updates the edge when the identity already exists', async () => {
    const fetchImpl = infoFetch(['1.5.0', '1.2.0']);

    const first = await executeDependAdd('@acme/base@^1.2.0', {
      directory: skillDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });
    expect(first.range).toBe('^1.2.0');

    const second = await executeDependAdd('@acme/base@~1.5.0', {
      directory: skillDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });
    expect(second).toMatchObject({ range: '~1.5.0', updated: true });

    const deps = readReleaseJson().dependencies;
    expect(Object.keys(deps).filter((key) => key === '@acme/base')).toHaveLength(1);
    expect(deps['@acme/base']).toBe('~1.5.0');
  });

  it.each([
    '@builtin/esl-operator',
    '@local/draft',
    'file:./base',
    'not-an-identity',
    '@acme/base@not-a-range'
  ])('rejects invalid target %s without writing the manifest', async (target) => {
    const fetchImpl = vi.fn();

    await expect(
      executeDependAdd(target, {
        directory: skillDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any
      })
    ).rejects.toMatchObject({ code: target.endsWith('not-a-range') ? 'releaseVersionMustBeValidSemver' : 'releaseDependencyTargetInvalid' });

    expect(readReleaseJson().dependencies).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps an invisible target and a missing target to stable codes', async () => {
    const forbidden = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ code: 'forbiddenNoAccessToThisPrivateSkillRequestAccessFromItsMaintainers' })
    });
    await expect(
      executeDependAdd('@acme/base', {
        directory: skillDir,
        server: 'http://localhost:3000',
        customFetch: forbidden as any
      })
    ).rejects.toMatchObject({ code: 'releaseDependencyNotVisible' });

    const missing = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ code: 'skillNotFound' })
    });
    await expect(
      executeDependAdd('@acme/base', {
        directory: skillDir,
        server: 'http://localhost:3000',
        customFetch: missing as any
      })
    ).rejects.toMatchObject({ code: 'releaseDependencyNoRelease' });

    expect(readReleaseJson().dependencies).toEqual({});
  });

  it('fails when there is no stable release or no version satisfies the given range', async () => {
    const prereleaseOnly = infoFetch(['1.0.0-beta.1']);
    await expect(
      executeDependAdd('@acme/base', {
        directory: skillDir,
        server: 'http://localhost:3000',
        customFetch: prereleaseOnly as any
      })
    ).rejects.toMatchObject({ code: 'releaseDependencyNoSatisfyingVersion' });

    const fetchImpl = infoFetch(['1.0.0', '2.0.0']);
    await expect(
      executeDependAdd('@acme/base@~1.5.0', {
        directory: skillDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any
      })
    ).rejects.toMatchObject({ code: 'releaseDependencyNoSatisfyingVersion' });
  });

  it('removes an edge and fails when the edge does not exist', async () => {
    const fetchImpl = infoFetch(['1.2.0']);
    await executeDependAdd('@acme/base', {
      directory: skillDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });

    const removed = await executeDependRemove('@acme/base', { directory: skillDir });
    expect(removed.identity).toBe('@acme/base');
    expect(readReleaseJson().dependencies).toEqual({});

    await expect(executeDependRemove('@acme/base', { directory: skillDir })).rejects.toMatchObject({
      code: 'dependEdgeNotFound'
    });
  });

  it('lists the declared dependencies', async () => {
    const fetchImpl = infoFetch(['1.2.0']);
    await executeDependAdd('@acme/base@^1.2.0', {
      directory: skillDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });

    const result = await executeDependList({ directory: skillDir });
    expect(result.dependencies).toEqual({ '@acme/base': '^1.2.0' });
    expect(formatDependList(result)).toContain('@acme/base ^1.2.0');
    expect(formatDependList({ dependencies: {} })).toMatch(/no release dependencies/i);
  });

  it('only changes release.json: it leaves a project .skills.json and the store untouched', async () => {
    fs.writeFileSync(path.join(tmpDir, '.skills.json'), JSON.stringify({ skills: { '@x/y': '^1.0.0' } }));
    const fetchImpl = infoFetch(['1.2.0']);

    await executeDependAdd('@acme/base', {
      directory: skillDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });

    expect(fs.existsSync(path.join(tmpDir, '.eslib'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, '.skills.json'), 'utf8'))).toEqual({
      skills: { '@x/y': '^1.0.0' }
    });
  });
});
