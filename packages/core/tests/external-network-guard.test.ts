import { describe, expect, it } from 'vitest';
import {
  assertPublicHost,
  assertPublicIpAddress,
  assertPublicHttpsGitUrl,
  isPublicIpAddress
} from '../src/skill/external/network-guard.js';

describe('assertPublicHttpsGitUrl', () => {
  it('接受公网 HTTPS 地址', () => {
    expect(() => assertPublicHttpsGitUrl('https://github.com/anthropics/skills.git')).not.toThrow();
    expect(() => assertPublicHttpsGitUrl('https://gitlab.com/some/group/repo')).not.toThrow();
  });

  it('拒绝 http（非加密）', () => {
    expect(() => assertPublicHttpsGitUrl('http://github.com/anthropics/skills')).toThrow();
  });

  it('拒绝其他协议（file/ssh/git）', () => {
    expect(() => assertPublicHttpsGitUrl('file:///srv/repo')).toThrow();
    expect(() => assertPublicHttpsGitUrl('ssh://git@github.com/repo')).toThrow();
    expect(() => assertPublicHttpsGitUrl('git@github.com:anthropics/skills.git')).toThrow();
  });

  it('拒绝带用户名/密码或凭据的地址', () => {
    expect(() => assertPublicHttpsGitUrl('https://user:pass@github.com/org/repo')).toThrow();
    expect(() => assertPublicHttpsGitUrl('https://token@github.com/org/repo')).toThrow();
  });

  it('拒绝非 URL 输入', () => {
    expect(() => assertPublicHttpsGitUrl('not a url')).toThrow();
  });
});

describe('isPublicIpAddress', () => {
  it('接受常见公网 IPv4', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('1.1.1.1')).toBe(true);
    expect(isPublicIpAddress('142.250.80.46')).toBe(true);
  });

  it('拒绝回环地址', () => {
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('127.99.0.1')).toBe(false);
  });

  it('拒绝私网地址（10/172.16/192.168）', () => {
    expect(isPublicIpAddress('10.0.0.1')).toBe(false);
    expect(isPublicIpAddress('10.255.255.255')).toBe(false);
    expect(isPublicIpAddress('172.16.0.1')).toBe(false);
    expect(isPublicIpAddress('172.31.255.255')).toBe(false);
    expect(isPublicIpAddress('192.168.1.1')).toBe(false);
  });

  it('172.15 与 172.32 是公网，只有 172.16..172.31 是私网', () => {
    expect(isPublicIpAddress('172.15.0.1')).toBe(true);
    expect(isPublicIpAddress('172.32.0.1')).toBe(true);
  });

  it('拒绝链路本地地址', () => {
    expect(isPublicIpAddress('169.254.1.1')).toBe(false);
  });

  it('拒绝 0.0.0.0 与保留地址', () => {
    expect(isPublicIpAddress('0.0.0.0')).toBe(false);
    expect(isPublicIpAddress('100.64.0.1')).toBe(false); // CGNAT
    expect(isPublicIpAddress('192.0.0.1')).toBe(false); // IETF 保留
    expect(isPublicIpAddress('192.0.2.1')).toBe(false); // TEST-NET-1
    expect(isPublicIpAddress('198.51.100.1')).toBe(false); // TEST-NET-2
    expect(isPublicIpAddress('203.0.113.1')).toBe(false); // TEST-NET-3
    expect(isPublicIpAddress('224.0.0.1')).toBe(false); // 组播
    expect(isPublicIpAddress('255.255.255.255')).toBe(false); // 广播
  });

  it('拒绝 IPv6 回环与私网', () => {
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('fc00::1')).toBe(false);
    expect(isPublicIpAddress('fd12::1')).toBe(false);
    expect(isPublicIpAddress('fe80::1')).toBe(false);
    expect(isPublicIpAddress('::')).toBe(false);
  });

  it('接受公网 IPv6', () => {
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('拒绝 IPv4-mapped 的私网地址 ::ffff:127.0.0.1', () => {
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('::ffff:192.168.0.1')).toBe(false);
  });
});

describe('assertPublicIpAddress', () => {
  it('对公网地址不抛错', () => {
    expect(() => assertPublicIpAddress('8.8.8.8')).not.toThrow();
  });

  it('对私网地址抛出带稳定错误码的异常', () => {
    try {
      assertPublicIpAddress('169.254.169.254');
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('externalSourceForbiddenAddress');
    }
  });
});

describe('assertPublicHost', () => {
  it('域名解析到公网地址时通过', async () => {
    await expect(
      assertPublicHost('github.com', async () => ['140.82.112.3'])
    ).resolves.toBeUndefined();
  });

  it('域名解析到私网地址时拒绝', async () => {
    await expect(
      assertPublicHost('evil.example', async () => ['127.0.0.1'])
    ).rejects.toMatchObject({ code: 'externalSourceForbiddenAddress' });
  });

  it('域名解析结果混杂私网地址时拒绝（任一命中即拒绝）', async () => {
    await expect(
      assertPublicHost('mixed.example', async () => ['8.8.8.8', '10.0.0.5'])
    ).rejects.toMatchObject({ code: 'externalSourceForbiddenAddress' });
  });

  it('IP 字面量不触发 DNS，直接校验', async () => {
    let called = false;
    const lookup = async () => {
      called = true;
      return ['8.8.8.8'];
    };
    await expect(assertPublicHost('169.254.169.254', lookup)).rejects.toMatchObject({
      code: 'externalSourceForbiddenAddress'
    });
    expect(called).toBe(false);
  });

  it('域名无法解析时给出仓库不存在错误', async () => {
    await expect(assertPublicHost('nope.example', async () => [])).rejects.toMatchObject({
      code: 'externalSourceRepositoryNotFound'
    });
  });
});
