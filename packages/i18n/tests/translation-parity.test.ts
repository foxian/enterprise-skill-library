import { describe, expect, it } from 'vitest';
import { translationResources, validateTranslationParity } from '../src/index.js';

describe('translation parity', () => {
  it('两套语言包包含 zh-CN 与 en-US 资源', () => {
    expect(Object.keys(translationResources).sort()).toEqual(['en-US', 'zh-CN']);
  });

  it('两套语言包键集合完全一致', () => {
    const parity = validateTranslationParity();
    expect(parity.missingInZhCN).toEqual([]);
    expect(parity.missingInEnUS).toEqual([]);
  });
});
