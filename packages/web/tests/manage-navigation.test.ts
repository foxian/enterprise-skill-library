import { describe, expect, it } from 'vitest';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import {
  buildManageEntryQuery,
  orgScopeFromQuery,
  passthroughEntryQuery,
  resolveSkillListLocation
} from '../src/skills/manage-navigation';

function routeLike(partial: {
  name?: string;
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
}): RouteLocationNormalizedLoaded {
  return {
    name: partial.name,
    params: partial.params ?? {},
    query: partial.query ?? {}
  } as unknown as RouteLocationNormalizedLoaded;
}

describe('技能深层页导航编解码', () => {
  it('组织技能页签进入时声明来源组织并携带列表状态', () => {
    const query = buildManageEntryQuery(
      routeLike({ name: 'me-org-skills', params: { org: 'acme' } }),
      { tab: 'shared', page: 2 }
    );
    expect(query).toEqual({ from: 'org-skills', org: 'acme', tab: 'shared', page: '2' });
  });

  it('全局列表进入时只带命名空间筛选，不带组织', () => {
    const query = buildManageEntryQuery(
      routeLike({ name: 'me-skills', query: { namespace: 'acme' } }),
      { tab: 'managed', page: 1 }
    );
    expect(query).toEqual({ from: 'skills', namespace: 'acme' });
  });

  it('超管深层页恒回技能总览', () => {
    expect(resolveSkillListLocation(routeLike({ name: 'super-skill-manage' }), true)).toEqual({
      name: 'super-skills'
    });
  });

  it('组织来源回到组织技能页签并恢复页签与页码', () => {
    expect(
      resolveSkillListLocation(
        routeLike({
          name: 'me-skill-manage',
          query: { from: 'org-skills', org: 'acme', tab: 'shared', page: '3' }
        }),
        false
      )
    ).toEqual({
      name: 'me-org-skills',
      params: { org: 'acme' },
      query: { tab: 'shared', page: '3' }
    });
  });

  it('畸形组织名降级回全局列表，不采信书签参数', () => {
    expect(
      resolveSkillListLocation(routeLike({ query: { from: 'org-skills', org: 'Bad Name!' } }), false)
    ).toEqual({ name: 'me-skills', query: {} });
  });

  it('缺少组织来源时回全局列表并透传命名空间筛选', () => {
    expect(
      resolveSkillListLocation(routeLike({ query: { from: 'skills', namespace: 'acme', tab: 'shared' } }), false)
    ).toEqual({ name: 'me-skills', query: { tab: 'shared', namespace: 'acme' } });
  });

  it('互链透传只保留字符串 query，避免数组参数污染', () => {
    expect(
      passthroughEntryQuery(routeLike({ query: { from: 'org-skills', org: 'acme', list: ['a', 'b'] } }))
    ).toEqual({ from: 'org-skills', org: 'acme' });
  });

  it('组织来源仅在合法组织名时成立', () => {
    expect(orgScopeFromQuery(routeLike({ query: { from: 'org-skills', org: 'acme' } }))).toBe('acme');
    expect(orgScopeFromQuery(routeLike({ query: { from: 'org-skills', org: 'x' } }))).toBe('');
    expect(orgScopeFromQuery(routeLike({ query: { from: 'skills', org: 'acme' } }))).toBe('');
    expect(orgScopeFromQuery(routeLike({ query: {} }))).toBe('');
  });
});
