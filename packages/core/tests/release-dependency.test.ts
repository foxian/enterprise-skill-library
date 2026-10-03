import { describe, expect, it } from 'vitest';
import {
  ReleaseGraphError,
  chooseMergedVersion,
  highestSatisfyingAllRanges,
  rangesIntersect,
  resolveReleaseGraph,
  validateReleaseDependencyTarget,
  type ReleaseGraphNode,
  type ReleaseGraphSource
} from '../src/index.js';

describe('chooseMergedVersion', () => {
  it('takes the higher version when it still satisfies every declared range', () => {
    expect(
      chooseMergedVersion({ existingVersion: '1.2.0', incomingVersion: '1.3.0', ranges: ['^1.0.0'] })
    ).toEqual({ version: '1.3.0' });
    expect(
      chooseMergedVersion({ existingVersion: '1.3.0', incomingVersion: '1.2.0', ranges: ['^1.0.0'] })
    ).toEqual({ version: '1.3.0' });
  });

  it('reports a conflict when the higher version breaks a range', () => {
    expect(
      chooseMergedVersion({ existingVersion: '1.2.0', incomingVersion: '2.0.0', ranges: ['~1.2.0'] })
    ).toEqual({ conflict: true });
  });
});

describe('validateReleaseDependencyTarget', () => {
  it('accepts a published server-hosted identity', () => {
    expect(validateReleaseDependencyTarget('@acme/style-guide')).toBeNull();
    expect(validateReleaseDependencyTarget('@cnfox/a1')).toBeNull();
  });

  it('rejects reserved scopes and non-server targets', () => {
    for (const target of [
      '@builtin/esl-operator',
      '@local/draft',
      'file:./skill',
      './skill',
      'acme/foo',
      '@acme',
      '@acme/foo/bar',
      '@admin/x'
    ]) {
      expect(validateReleaseDependencyTarget(target)).toBe('releaseDependencyTargetInvalid');
    }
  });
});

describe('rangesIntersect', () => {
  it('is true when ranges overlap', () => {
    expect(rangesIntersect(['^1.0.0', '~1.2.0'])).toBe(true);
    expect(rangesIntersect(['>=1.0.0 <2.0.0', '>=1.5.0'])).toBe(true);
    expect(rangesIntersect(['*', '^1.0.0'])).toBe(true);
    expect(rangesIntersect(['1.0.0 - 1.5.0', '>=1.4.0 <2.0.0'])).toBe(true);
  });

  it('is true for prerelease windows that overlap', () => {
    expect(rangesIntersect(['>=1.0.0-beta.1 <1.0.0', '>=1.0.0-beta.2 <1.0.0'])).toBe(true);
  });

  it('is false when ranges are disjoint', () => {
    expect(rangesIntersect(['^1.0.0', '^2.0.0'])).toBe(false);
    expect(rangesIntersect(['>1.0.0 <2.0.0', '<=1.0.0'])).toBe(false);
    expect(rangesIntersect(['>=1.0.0-beta.1 <1.0.0-beta.3', '>=1.0.0-beta.4 <1.0.0'])).toBe(false);
  });

  it('is true for a single valid range', () => {
    expect(rangesIntersect(['^1.0.0'])).toBe(true);
  });
});

describe('highestSatisfyingAllRanges', () => {
  it('picks the highest version satisfying every range', () => {
    expect(highestSatisfyingAllRanges(['1.2.0', '1.3.0', '1.4.0'], ['^1.2.0', '~1.3.0'])).toBe('1.3.0');
  });

  it('returns undefined when no version satisfies all ranges', () => {
    expect(highestSatisfyingAllRanges(['1.2.0', '2.0.0'], ['^1.0.0', '~1.5.0'])).toBeUndefined();
  });

  it('does not pick a prerelease for plain ranges', () => {
    expect(highestSatisfyingAllRanges(['1.3.0', '1.4.0-beta.1'], ['^1.0.0'])).toBe('1.3.0');
  });
});

interface FixtureRelease {
  version: string;
  dependencies?: Record<string, string>;
  visibility?: 'public' | 'private';
}

class FakeGraphSource implements ReleaseGraphSource {
  readonly fetchedFor = new Set<string>();
  // null 表示技能存在但读不到；缺键/空数组表示没有可装的发布版本。
  constructor(private readonly registry: Map<string, FixtureRelease[] | null>) {}

  async listVersions(identity: string): Promise<string[]> {
    if (!this.registry.has(identity)) return [];
    const releases = this.registry.get(identity);
    if (releases === null) {
      throw new ReleaseGraphError('releaseDependencyNotVisible', { identity });
    }
    return releases.map((release) => release.version);
  }

  async load(identity: string, version: string): Promise<ReleaseGraphNode> {
    this.fetchedFor.add(`${identity}@${version}`);
    const release = this.registry.get(identity)!.find((entry) => entry.version === version)!;
    return {
      identity,
      skillId: `sk_${identity.replace(/[@/]/g, '_')}`,
      version,
      checksum: `sha256-${version}`,
      visibility: release.visibility ?? 'public',
      dependencies: release.dependencies ?? {}
    };
  }
}

function source(
  releases: Array<[string, FixtureRelease[] | null]>
): FakeGraphSource {
  return new FakeGraphSource(new Map(releases));
}

describe('resolveReleaseGraph', () => {
  it('freezes a diamond at the highest version inside the intersection, once per identity', async () => {
    const graph = source([
      ['@alice/d', [{ version: '1.2.0' }, { version: '1.3.0' }, { version: '1.4.0' }]],
      ['@alice/b', [{ version: '1.0.0', dependencies: { '@alice/d': '^1.2.0' } }]],
      ['@alice/c', [{ version: '1.0.0', dependencies: { '@alice/d': '~1.3.0' } }]]
    ]);

    const lock = await resolveReleaseGraph(
      { '@alice/b': '^1.0.0', '@alice/c': '^1.0.0' },
      graph
    );

    expect(Object.keys(lock)).toEqual(['@alice/b', '@alice/c', '@alice/d']);
    expect(lock['@alice/d']).toEqual({
      skillId: 'sk__alice_d',
      version: '1.3.0',
      checksum: 'sha256-1.3.0'
    });
  });

  it('fails when ranges have no intersection, instead of forcing the global highest', async () => {
    const graph = source([
      ['@alice/d', [{ version: '1.5.0' }]],
      ['@alice/b', [{ version: '1.0.0', dependencies: { '@alice/d': '^1.0.0' } }]],
      ['@alice/c', [{ version: '1.0.0', dependencies: { '@alice/d': '^2.0.0' } }]]
    ]);

    await expect(
      resolveReleaseGraph({ '@alice/b': '^1.0.0', '@alice/c': '^1.0.0' }, graph)
    ).rejects.toMatchObject({ code: 'releaseDependencyRangesDoNotIntersect' });
  });

  it('fails on a dependency cycle, including self-dependency', async () => {
    const cyclic = source([
      ['@alice/a', [{ version: '1.0.0', dependencies: { '@alice/b': '^1.0.0' } }]],
      ['@alice/b', [{ version: '1.0.0', dependencies: { '@alice/a': '^1.0.0' } }]]
    ]);
    await expect(resolveReleaseGraph({ '@alice/a': '^1.0.0' }, cyclic)).rejects.toMatchObject({
      code: 'releaseDependencyCycle'
    });

    const selfCycle = source([
      ['@alice/a', [{ version: '1.0.0', dependencies: { '@alice/a': '^1.0.0' } }]]
    ]);
    await expect(resolveReleaseGraph({ '@alice/a': '^1.0.0' }, selfCycle)).rejects.toMatchObject({
      code: 'releaseDependencyCycle'
    });
  });

  it('fails when the target has no published release, or no version satisfies the range', async () => {
    const unknown = source([['@alice/b', [{ version: '1.0.0' }]]]);
    await expect(resolveReleaseGraph({ '@alice/missing': '^1.0.0' }, unknown)).rejects.toMatchObject({
      code: 'releaseDependencyNoRelease'
    });

    const unsatisfiable = source([
      ['@alice/d', [{ version: '1.0.0' }, { version: '2.0.0' }]]
    ]);
    await expect(resolveReleaseGraph({ '@alice/d': '~1.5.0' }, unsatisfiable)).rejects.toMatchObject({
      code: 'releaseDependencyNoSatisfyingVersion'
    });
  });

  it('treats a root edge pointing back at the root identity as a cycle', async () => {
    // 目标版本自己的清单没有自边，也要靠 rootIdentity 检出。
    const graph = source([['@alice/root', [{ version: '1.0.0' }]]]);
    await expect(
      resolveReleaseGraph({ '@alice/root': '^1.0.0' }, graph, { rootIdentity: '@alice/root' })
    ).rejects.toMatchObject({ code: 'releaseDependencyCycle' });
  });

  it('propagates a not-visible error from the source', async () => {
    await expect(
      resolveReleaseGraph({ '@alice/private': '^1.0.0' }, source([['@alice/private', null]]))
    ).rejects.toMatchObject({ code: 'releaseDependencyNotVisible' });
  });

  it('requires every node of a public root to be public, but allows private chains for private roots', async () => {
    const registry: Array<[string, FixtureRelease[]]> = [
      ['@alice/d', [{ version: '1.0.0', visibility: 'private' }]]
    ];
    await expect(
      resolveReleaseGraph({ '@alice/d': '^1.0.0' }, source(registry), { rootVisibility: 'public' })
    ).rejects.toMatchObject({ code: 'releaseDependencyPublicChainMustBePublic' });

    const lock = await resolveReleaseGraph({ '@alice/d': '^1.0.0' }, source(registry), {
      rootVisibility: 'private'
    });
    expect(lock['@alice/d'].version).toBe('1.0.0');
  });

  it('does not let a reselected version leave stale child ranges behind', async () => {
    // B@1.5.0 拉 D^2.0.0，B@1.2.0 拉 D^1.0.0；C 逼 B 退到 1.2.0 后，D^2.0.0 已
    // 不可达，不能把它的范围算进 D 的交集而误报冲突。
    const graph = source([
      ['@x/d', [{ version: '1.0.0' }, { version: '2.0.0' }]],
      ['@x/b', [
        { version: '1.5.0', dependencies: { '@x/d': '^2.0.0' } },
        { version: '1.2.0', dependencies: { '@x/d': '^1.0.0' } }
      ]],
      ['@x/c', [{ version: '1.0.0', dependencies: { '@x/b': '~1.2.0' } }]]
    ]);

    const lock = await resolveReleaseGraph({ '@x/b': '^1.0.0', '@x/c': '^1.0.0' }, graph);

    expect(lock['@x/b'].version).toBe('1.2.0');
    expect(lock['@x/d'].version).toBe('1.0.0');
    expect(Object.keys(lock).sort()).toEqual(['@x/b', '@x/c', '@x/d']);
  });

  it('drops edges that become unreachable after a version reselect', async () => {
    const graph = source([
      ['@alice/x', [{ version: '1.0.0' }]],
      ['@alice/y', [{ version: '1.0.0' }]],
      ['@alice/b', [
        { version: '1.5.0', dependencies: { '@alice/x': '^1.0.0' } },
        { version: '1.2.0', dependencies: { '@alice/y': '^1.0.0' } }
      ]],
      ['@alice/c', [{ version: '1.0.0', dependencies: { '@alice/b': '~1.2.0' } }]]
    ]);

    const lock = await resolveReleaseGraph(
      { '@alice/b': '^1.0.0', '@alice/c': '^1.0.0' },
      graph
    );

    expect(Object.keys(lock)).toEqual(['@alice/b', '@alice/c', '@alice/y']);
    expect(lock['@alice/b'].version).toBe('1.2.0');
  });
});
