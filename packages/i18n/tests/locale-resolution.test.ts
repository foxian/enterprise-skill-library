import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, resolveLocale } from '../src/index.js';

describe('locale resolution', () => {
  it('只支持 zh-CN 与 en-US，默认 en-US', () => {
    expect(SUPPORTED_LOCALES).toEqual(['zh-CN', 'en-US']);
    expect(DEFAULT_LOCALE).toBe('en-US');
  });

  it('无任何语言信息时返回 en-US', () => {
    expect(resolveLocale({})).toBe('en-US');
  });

  it('临时覆盖优先于账户 locale 与浏览器语言', () => {
    expect(
      resolveLocale({ override: 'zh-CN', accountLocale: 'en-US', browserLanguages: ['en-US'] })
    ).toBe('zh-CN');
  });

  it('无覆盖时使用账户 locale', () => {
    expect(resolveLocale({ accountLocale: 'zh-CN', browserLanguages: ['en-US'] })).toBe('zh-CN');
  });

  it('账户 locale 为 null 时回退浏览器语言', () => {
    expect(resolveLocale({ accountLocale: null, browserLanguages: ['zh-CN'] })).toBe('zh-CN');
  });

  it('zh-* 浏览器语言解析为 zh-CN', () => {
    expect(resolveLocale({ browserLanguages: ['zh-TW', 'zh'] })).toBe('zh-CN');
    expect(resolveLocale({ browserLanguages: ['zh'] })).toBe('zh-CN');
  });

  it('en-* 浏览器语言解析为 en-US', () => {
    expect(resolveLocale({ browserLanguages: ['en-GB'] })).toBe('en-US');
  });

  it('不受支持的语言解析为 en-US', () => {
    expect(resolveLocale({ browserLanguages: ['fr-FR', 'ja'] })).toBe('en-US');
  });

  it('先精确匹配再按语言主标签匹配', () => {
    expect(resolveLocale({ browserLanguages: ['zh-TW', 'en-US'] })).toBe('zh-CN');
  });
});
