import { describe, expect, it } from 'vitest';
import {
  discoverCatalogEntries,
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

  it('limits an anonymous subject to the anonymous visibility tier', () => {
    const entries = entriesFor({ username: null, organizationScopes: [] }, () => true);

    // 匿名的公开面只有 anonymous：owner 本人的 private 也不会混入。
    expect(identities(entries)).toEqual(['@beta/open']);
    // 匿名主体没有组织集合，组织 public/anonymous 按「平台公开」呈现。
    expect(entries[0]).toMatchObject({ bucket: 'platform', namespaceKind: 'organization' });
  });
});
