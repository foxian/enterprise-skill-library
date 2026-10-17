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

  // account-policy 校验失败改用稳定错误码（#145）：服务端不再下发硬编码英文 detail。
  it('翻译账号策略校验错误码', () => {
    expect(
      translateApiError({
        locale: 'zh-CN',
        code: 'usernameIsReserved',
        fallback: 'Username is reserved'
      })
    ).toBe('用户名为保留名');
    expect(
      translateApiError({
        locale: 'zh-CN',
        code: 'passwordMustBeAtLeastNCharacters',
        params: { min: '8' },
        fallback: 'Password must be at least 8 characters'
      })
    ).toBe('密码至少需要 8 个字符');
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
