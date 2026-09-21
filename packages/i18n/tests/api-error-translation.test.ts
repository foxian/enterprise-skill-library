import { describe, expect, it } from 'vitest';
import { translateApiError } from '../src/index.js';

describe('translateApiError', () => {
  it('按稳定 code 翻译中文错误', () => {
    expect(
      translateApiError({
        locale: 'zh-CN',
        code: 'usernameAndPasswordAreRequired',
        fallback: 'Username and password are required'
      })
    ).toBe('需要提供用户名和密码');
  });

  it('对动态参数执行插值', () => {
    expect(
      translateApiError({
        locale: 'zh-CN',
        code: 'unsupportedLocale',
        params: { locale: 'fr-FR' },
        fallback: 'Unsupported locale: fr-FR'
      })
    ).toBe('不支持的语言：fr-FR');
  });

  it('未知 code 使用英文兜底消息', () => {
    expect(
      translateApiError({
        locale: 'zh-CN',
        code: 'futureErrorCode',
        fallback: 'The request failed'
      })
    ).toBe('The request failed');
  });
});
