import { describe, expect, it } from 'vitest';
import {
  detectLicenseFromFiles,
  LICENSE_FILE_CANDIDATES,
  mergeUpstreamMetadata
} from '../src/skill/external/license-detect.js';
import type { ByteFileMap } from '../src/skill/published-package-archive.js';

function mapOf(entries: Record<string, string>): ByteFileMap {
  return Object.fromEntries(
    Object.entries(entries).map(([filePath, body]) => [filePath, Buffer.from(body, 'utf8')])
  );
}

describe('LICENSE_FILE_CANDIDATES', () => {
  it('包含常见许可证文件名', () => {
    expect(LICENSE_FILE_CANDIDATES).toContain('LICENSE');
    expect(LICENSE_FILE_CANDIDATES.some((name) => name.toLowerCase() === 'license.md')).toBe(true);
  });
});

describe('detectLicenseFromFiles', () => {
  it('从 LICENSE 文件正文识别 MIT', () => {
    const files = mapOf({
      LICENSE:
        'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software...'
    });
    const result = detectLicenseFromFiles(files);
    expect(result.license).toBe('MIT');
    expect(result.provenance).toBeDefined();
  });

  it('从 Apache 许可证正文识别 Apache-2.0', () => {
    const files = mapOf({
      LICENSE: 'Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/'
    });
    const result = detectLicenseFromFiles(files);
    expect(result.license).toBe('Apache-2.0');
  });

  it('从 BSD 三句版识别 BSD-3-Clause', () => {
    const files = mapOf({
      LICENSE:
        'Redistribution and use in source and binary forms\nNeither the name of the copyright holder\n'
    });
    const result = detectLicenseFromFiles(files);
    expect(result.license).toBe('BSD-3-Clause');
  });

  it('无许可证信息时返回不确定，不猜测默认许可证', () => {
    const files = mapOf({ 'SKILL.md': 'no license anywhere' });
    const result = detectLicenseFromFiles(files);
    expect(result.license).toBeUndefined();
  });

  it('返回许可证来源路径', () => {
    const files = mapOf({ 'LICENSE.md': 'MIT License\nfree of charge' });
    const result = detectLicenseFromFiles(files);
    expect(result.provenance?.path).toBe('LICENSE.md');
  });
});

describe('mergeUpstreamMetadata', () => {
  it('在无 release.json 时由平台生成身份与版本，不采用上游身份', () => {
    const merged = mergeUpstreamMetadata({
      platformIdentity: '@alice/webapp-testing',
      platformVersion: '0.1.0',
      detectedLicense: 'MIT',
      upstreamFiles: mapOf({ 'SKILL.md': 'name: webapp-testing\ndescription: Upstream desc' })
    });
    expect(merged.name).toBe('@alice/webapp-testing');
    expect(merged.version).toBe('0.1.0');
    expect(merged.license).toBe('MIT');
  });

  it('上游 release.json 的描述与许可证可复用，但身份与版本以平台为准', () => {
    const merged = mergeUpstreamMetadata({
      platformIdentity: '@alice/webapp-testing',
      platformVersion: '0.1.3',
      detectedLicense: 'MIT',
      upstreamFiles: mapOf({
        'release.json': JSON.stringify({
          schemaVersion: 4,
          name: '@upstream/webapp-testing',
          version: '9.9.9',
          license: 'Apache-2.0',
          description: 'upstream description',
          keywords: ['test'],
          dependencies: {}
        })
      })
    });
    expect(merged.name).toBe('@alice/webapp-testing');
    expect(merged.version).toBe('0.1.3');
    expect(merged.license).toBe('Apache-2.0');
    expect(merged.keywords).toEqual(['test']);
  });

  it('上游 release.json 中的身份字段不能覆盖平台身份', () => {
    const merged = mergeUpstreamMetadata({
      platformIdentity: '@alice/locked-name',
      platformVersion: '0.1.0',
      detectedLicense: 'MIT',
      upstreamFiles: mapOf({
        'release.json': JSON.stringify({
          schemaVersion: 4,
          name: '@someone-else/evil',
          version: '0.0.1',
          license: 'MIT',
          dependencies: {}
        })
      })
    });
    expect(merged.name).toBe('@alice/locked-name');
  });
});
