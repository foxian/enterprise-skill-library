import { describe, expect, it } from 'vitest';
import {
  discoverCatalogEntries,
  filterCatalogEntries,
  type CatalogBucket,
  type CatalogCandidate,
  type CatalogNamespaceKind,
  type CatalogPrincipal,
  type SkillVisibility
} from '../src/index.js';

// 技能目录（#199 / spec #200）的 core 主接缝：给定「服务端已取到并判定可读」的
// 候选与当前主体，断言可安装全集、互斥就近归桶与归属信息。授权事实由 server 实时
// 计算（accessGranted），core 只负责可见性基线与归类，不反向依赖 Git Backend。

interface SeedInput {
  identity: string;
  scope: string;
  visibility?: SkillVisibility;
  namespaceKind?: CatalogNamespaceKind;
}

function seed(input: SeedInput, accessGranted: boolean): CatalogCandidate {
  const skillName = input.identity.slice(input.identity.indexOf('/') + 1);
  return {
    identity: input.identity,
    scope: input.scope,
    skillName,
    displayName: skillName,
    description: `${input.identity} skill`,
    visibility: input.visibility ?? 'public',
    namespaceKind: input.namespaceKind ?? 'organization',
    downloadCount: 2,
    latestStableVersion: '1.0.0',
    keywords: ['code-review'],
    accessGranted
  };
}

// 夹具覆盖验收所需的最小 seed：平台 public/anonymous、组织 public、组织 private、
// 他人个人 private、本人个人 public/private。
function catalogCandidates(accessGranted: (identity: string) => boolean): CatalogCandidate[] {
  const rows: SeedInput[] = [
    { identity: '@acme/tool', scope: 'acme', visibility: 'public' },
    { identity: '@acme/notes', scope: 'acme', visibility: 'private' },
    { identity: '@beta/lib', scope: 'beta', visibility: 'public' },
    { identity: '@beta/open', scope: 'beta', visibility: 'anonymous' },
    {
      identity: '@bob/secret',
      scope: 'bob',
      visibility: 'private',
      namespaceKind: 'personal'
    },
    {
      identity: '@alice/mine',
      scope: 'alice',
      visibility: 'private',
      namespaceKind: 'personal'
    },
    { identity: '@alice/pub', scope: 'alice', visibility: 'public', namespaceKind: 'personal' }
  ];
  return rows.map((row) =>
    seed(row, row.visibility === 'private' ? accessGranted(row.identity) : false)
  );
}

function entriesFor(principal: CatalogPrincipal, accessGranted: (identity: string) => boolean) {
  return discoverCatalogEntries(catalogCandidates(accessGranted), principal);
}

function identities(entries: ReturnType<typeof entriesFor>): string[] {
  return entries.map((entry) => entry.identity).sort();
}

describe('discoverCatalogEntries', () => {
  it('collects every installable skill of a multi-organization member exactly once', () => {
    const entries = entriesFor({ username: 'alice', organizationScopes: ['acme', 'beta'] }, (identity) =>
      ['@acme/notes', '@bob/secret', '@alice/mine'].includes(identity)
    );

    expect(identities(entries)).toEqual(
      [
        '@acme/tool',
        '@acme/notes',
        '@beta/lib',
        '@beta/open',
        '@bob/secret',
        '@alice/mine',
        '@alice/pub'
      ].sort()
    );

    const byIdentity = new Map(entries.map((entry) => [entry.identity, entry]));
    // 所在组织的 public 按「就近」落入「我的组织」，并标出组织归属。
    expect(byIdentity.get('@acme/tool')).toMatchObject({
      bucket: 'org',
      namespaceKind: 'organization',
      source: { kind: 'organization', name: 'acme' }
    });
    // 组织 private 经授权到达同一桶，多组织扁平聚合。
    expect(byIdentity.get('@acme/notes')).toMatchObject({ bucket: 'org' });
    expect(byIdentity.get('@beta/lib')).toMatchObject({ bucket: 'org' });
    // 他人直授的个人 private 进「授权给我」，来源是技能所属主体。
    expect(byIdentity.get('@bob/secret')).toMatchObject({
      bucket: 'granted',
      namespaceKind: 'personal',
      source: { kind: 'person', name: 'bob' }
    });
    // 本人发布的 private 也在「授权给我」，但来源是「我的技能」。
    expect(byIdentity.get('@alice/mine')).toMatchObject({
      bucket: 'granted',
      source: { kind: 'self', name: 'alice' }
    });
    // 本人个人 public 进「平台公开」，归属类型仍是个人。
    expect(byIdentity.get('@alice/pub')).toMatchObject({
      bucket: 'platform',
      namespaceKind: 'personal'
    });
  });

  it('gives a new user without organizations the public and anonymous set only', () => {
    const entries = entriesFor({ username: 'zoe', organizationScopes: [] }, () => false);

    expect(identities(entries)).toEqual(
      ['@acme/tool', '@beta/lib', '@beta/open', '@alice/pub'].sort()
    );
    // 归属类型与桶无关：组织 public 对无组织用户是「平台公开」，但仍标组织归属。
    for (const entry of entries) {
      expect(entry.bucket).toBe('platform');
    }
    expect(entries.find((entry) => entry.identity === '@acme/tool')).toMatchObject({
      namespaceKind: 'organization',
      source: { kind: 'organization', name: 'acme' }
    });
  });

  it('excludes private skills the subject cannot read, even inside its own organization', () => {
    const entries = entriesFor({ username: 'olga', organizationScopes: ['acme'] }, () => false);

    expect(identities(entries)).toEqual(
      ['@acme/tool', '@beta/lib', '@beta/open', '@alice/pub'].sort()
    );
    expect(entries.map((entry) => entry.identity)).not.toContain('@acme/notes');
  });

  it('fails closed for organization private skills outside the resolved organization set', () => {
    // 技术核查 §1.3.4：组织 private 可读却不在我的组织集合，属于不变量破坏（如
    // 离组后残留 owner/maintainers）。必须排除，不得猜成 granted 或 platform。
    const resolved = entriesFor(
      { username: 'zoe', organizationScopes: ['beta'], organizationScopesResolved: true },
      (identity) => identity === '@acme/notes'
    );
    expect(identities(resolved)).not.toContain('@acme/notes');

    // 公开搜索不解析组织集合（标记缺省 false），行为保持不变：可读即进入 granted。
    const unresolved = entriesFor(
      { username: 'zoe', organizationScopes: [] },
      (identity) => identity === '@acme/notes'
    );
    expect(unresolved.find((entry) => entry.identity === '@acme/notes')).toMatchObject({
      bucket: 'granted'
    });

    // 组织集合已解析时，其他组织的 public/anonymous 仍按「平台公开」呈现（AC4）。
    const publicOnly = entriesFor(
      { username: 'zoe', organizationScopes: [], organizationScopesResolved: true },
      () => false
    );
    expect(publicOnly.find((entry) => entry.identity === '@acme/tool')?.bucket).toBe('platform');
  });

  it('limits an anonymous subject to the anonymous visibility tier', () => {
    const entries = entriesFor({ username: null, organizationScopes: [] }, () => true);

    // 匿名的公开面只有 anonymous：owner 本人的 private 也不会混入。
    expect(identities(entries)).toEqual(['@beta/open']);
    // 匿名主体没有组织集合，组织 public/anonymous 按「平台公开」呈现。
    expect(entries[0]).toMatchObject({ bucket: 'platform', namespaceKind: 'organization' });
  });
});

// 桶筛选与关键词（本票 #203）：浏览器只会在 `all` 与三个互斥桶之间切换，关键词
// 必须与当前桶 AND 叠加；筛选是纯内存操作，可读性已在发现阶段决定，不反向依赖 Gitea。
describe('filterCatalogEntries', () => {
  const alice: CatalogPrincipal = { username: 'alice', organizationScopes: ['acme', 'beta'] };
  const aliceEntries = entriesFor(alice, (identity) =>
    ['@acme/notes', '@bob/secret', '@alice/mine'].includes(identity)
  );

  function ofBucket(bucket: CatalogBucket) {
    return filterCatalogEntries(aliceEntries, { bucket });
  }

  it('splits the full set into three mutually exclusive buckets whose union is the whole set', () => {
    const all = filterCatalogEntries(aliceEntries, { bucket: 'all' });
    const org = ofBucket('org');
    const platform = ofBucket('platform');
    const granted = ofBucket('granted');

    // 期望来自验收口径（技术核查 §1.3），不是从实现反推。
    expect(identities(all)).toEqual(
      [
        '@acme/tool',
        '@acme/notes',
        '@beta/lib',
        '@beta/open',
        '@bob/secret',
        '@alice/mine',
        '@alice/pub'
      ].sort()
    );
    expect(identities(org)).toEqual(
      ['@acme/tool', '@acme/notes', '@beta/lib', '@beta/open'].sort()
    );
    expect(identities(platform)).toEqual(['@alice/pub']);
    expect(identities(granted)).toEqual(['@bob/secret', '@alice/mine'].sort());

    const union = [...org, ...platform, ...granted].map((entry) => entry.identity);
    expect(union.sort()).toEqual(identities(all));
    // 三桶两两不交：并集条数等于各桶条数之和。
    expect(new Set(union).size).toBe(union.length);
  });

  it('flattens multiple organizations into one bucket and keeps each organization name', () => {
    const org = ofBucket('org');

    expect(org.map((entry) => [entry.identity, entry.source.name]).sort()).toEqual(
      [
        ['@acme/notes', 'acme'],
        ['@acme/tool', 'acme'],
        ['@beta/lib', 'beta'],
        ['@beta/open', 'beta']
      ].sort()
    );
  });

  it('returns an empty bucket for a subject without organizations or grants', () => {
    const zoeEntries = entriesFor({ username: 'zoe', organizationScopes: [] }, () => false);

    expect(filterCatalogEntries(zoeEntries, { bucket: 'org' })).toEqual([]);
    expect(filterCatalogEntries(zoeEntries, { bucket: 'granted' })).toEqual([]);
    expect(identities(filterCatalogEntries(zoeEntries, { bucket: 'platform' }))).toEqual(
      ['@acme/tool', '@beta/lib', '@beta/open', '@alice/pub'].sort()
    );
  });

  it('combines the keyword with the selected bucket using AND', () => {
    expect(identities(filterCatalogEntries(aliceEntries, { bucket: 'org', query: 'notes' }))).toEqual([
      '@acme/notes'
    ]);
    expect(identities(filterCatalogEntries(aliceEntries, { bucket: 'granted', query: 'secret' }))).toEqual([
      '@bob/secret'
    ]);
    // 跨桶命中不算：`notes` 属于 org 桶，在 granted 桶里必须为空。
    expect(filterCatalogEntries(aliceEntries, { bucket: 'granted', query: 'notes' })).toEqual([]);
    expect(filterCatalogEntries(aliceEntries, { bucket: 'platform', query: 'acme' })).toEqual([]);
    // 只有 all 才跨全集。
    expect(identities(filterCatalogEntries(aliceEntries, { bucket: 'all', query: 'notes' }))).toEqual([
      '@acme/notes'
    ]);
  });

  it('matches identity, description, display name, and release keywords case-insensitively', () => {
    const entry = {
      ...seed({ identity: '@gamma/alpha-skill', scope: 'gamma' }, false),
      description: 'Unrelated prose',
      displayName: 'Delta Display',
      keywords: ['epsilon', 'Zeta Tag']
    };
    const entries = discoverCatalogEntries([entry], { username: 'zoe', organizationScopes: [] });

    const matched = (query: string) =>
      filterCatalogEntries(entries, { bucket: 'all', query }).map((item) => item.identity);

    expect(matched('gamma')).toEqual(['@gamma/alpha-skill']);
    expect(matched('alpha-skill')).toEqual(['@gamma/alpha-skill']);
    expect(matched('UNRELATED')).toEqual(['@gamma/alpha-skill']);
    expect(matched('delta display')).toEqual(['@gamma/alpha-skill']);
    expect(matched('epsilon')).toEqual(['@gamma/alpha-skill']);
    expect(matched('zeta tag')).toEqual(['@gamma/alpha-skill']);
    expect(matched('  epsilon  ')).toEqual(['@gamma/alpha-skill']);
    expect(matched('gamma-tool')).toEqual([]);
  });

  it('treats an empty or blank keyword as no keyword filter', () => {
    expect(identities(filterCatalogEntries(aliceEntries, { bucket: 'all', query: '' }))).toEqual(
      ['@acme/tool', '@acme/notes', '@beta/lib', '@beta/open', '@bob/secret', '@alice/mine', '@alice/pub'].sort()
    );
    expect(identities(filterCatalogEntries(aliceEntries, { bucket: 'org', query: '   ' }))).toEqual(
      ['@acme/tool', '@acme/notes', '@beta/lib', '@beta/open'].sort()
    );
  });
});
