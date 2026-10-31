import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInstall } from '../src/commands/install.js';
import { initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig, saveCredentials, createPublishedSkillPackage, sha256Integrity } from '@esl/core';

interface PackageSpec {
  name: string;
  skillId: string;
  version: string;
  dependencies?: Record<string, string>;
  dependencyLock?: Record<string, { skillId: string; version: string; checksum: string }>;
}

function buildPackage(spec: PackageSpec): { bytes: Buffer; checksum: string } {
  const bytes = Buffer.from(
    JSON.stringify({
      name: spec.name,
      skillId: spec.skillId,
      version: spec.version,
      sourceCommit: `${spec.skillId}-${spec.version}`,
      releaseManifest: { compatibility: {}, dependencies: spec.dependencies ?? {} },
      dependencyLock: spec.dependencyLock ?? {},
      files: {
        'SKILL.md': `---\nname: ${spec.name.replace('@', '').replace('/', ':')}\ndescription: x\n---\n`,
        'skill.json': JSON.stringify({
          name: spec.name,
          version: spec.version,
          description: 'x',
          author: 'tester',
          dependencies: spec.dependencies ?? {}
        })
      }
    })
  );
  return { bytes, checksum: `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}` };
}

function ok(value: unknown) {
  return { ok: true, ...(value as object) };
}

function packageResponse(bytes: Buffer) {
  return { ok: true, arrayBuffer: async () => bytes };
}

function infoResponse(name: string, visibility: string) {
  return { ok: true, json: async () => ({ name, visibility, instanceId: '11111111-1111-4111-8111-111111111111', versions: [] }) };
}

describe('esl install multi-root merge', () => {
  let projectDir: string;
  let homeDir: string;
  const server = 'http://localhost:4070';

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-multroot-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-multroot-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: [] }, { homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function installOptions(customFetch: unknown) {
    return {
      projectRoot: projectDir,
      homeDir,
      server,
      customFetch: customFetch as never,
      execFileAsync: vi.fn() as never,
      noAdapt: true
    };
  }

  const sharedStoreJson = () =>
    JSON.parse(
      fs.readFileSync(
        path.join(projectDir, '.eslib', 'skills', '11111111-1111-4111-8111-111111111111', '@platform-ai', 'shared', 'skill.json'),
        'utf8'
      )
    ) as { version: string };

  async function installRootA(customFetch: unknown) {
    // 根 A 依赖 shared，锁在 1.2.0；A 的清单范围是 ^1.0.0。
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const rootA = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-a',
            visibility: 'public',
            instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_a/1.0.0/${rootA.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootA.bytes))
      .mockResolvedValueOnce(packageResponse(shared.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'));
    await executeInstall('@platform-ai/root-a', installOptions(fetch));
  }

  it.each(['zip', 'json'] as const)('安装冻锁依赖兼容 %s 包并记录实际下载地址', async (format) => {
    const binary = Buffer.from([0x50, 0x4b, 0x00, 0xff, 0x80]);
    const legacy = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const original = JSON.parse(legacy.bytes.toString('utf8'));
    const zipBytes = await createPublishedSkillPackage(original, {
      ...Object.fromEntries(Object.entries(original.files).map(([name, text]) => [name, Buffer.from(text as string)])),
      'assets/示例.docx': binary
    });
    const bytes = format === 'zip' ? zipBytes : legacy.bytes;
    const checksum = sha256Integrity(bytes);
    const root = buildPackage({
      name: '@platform-ai/root-a', skillId: 'sk_a', version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum } }
    });
    const rootUrl = `/api/packages/sk_a/1.0.0/${root.checksum}.json`;
    const dependencyUrl = `${server}/api/packages/sk_shared/1.2.0/${checksum}`;
    const fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      // #136：包请求统一追加 ?requested=<specifier>，根技能为 latest，冻锁依赖为精确版本。
      if (url.includes(rootUrl)) return packageResponse(root.bytes);
      if (url.startsWith(`${dependencyUrl}.zip?`) || url === `${dependencyUrl}.zip`) {
        return format === 'zip' ? packageResponse(bytes) : { ok: false, status: 404 };
      }
      if (url.startsWith(`${dependencyUrl}.json?`) || url === `${dependencyUrl}.json`) return packageResponse(bytes);
      if (url.includes('/api/skills/')) return ok({ json: async () => ({
        name: '@platform-ai/root-a', visibility: 'public', instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'], packageUrl: rootUrl
      }) });
      throw new Error(`Unexpected URL: ${url}`);
    });
    await executeInstall('@platform-ai/root-a', installOptions(fetch));
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@platform-ai/shared#11111111-1111-4111-8111-111111111111'].resolved).toBe(`${dependencyUrl}.${format}`);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith(`${rootUrl}?requested=latest`))).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith(`${dependencyUrl}.`) && String(url).includes('requested=1.2.0'))).toBe(true);
    if (format === 'zip') {
      expect(fs.readFileSync(path.join(projectDir, '.eslib', 'skills', '11111111-1111-4111-8111-111111111111', '@platform-ai', 'shared', 'assets', '示例.docx'))).toEqual(binary);
      expect(fetch.mock.calls.some(([url]) => String(url).startsWith(`${dependencyUrl}.json`))).toBe(false);
    } else {
      expect(fetch.mock.calls.some(([url]) => String(url).startsWith(`${dependencyUrl}.json`))).toBe(true);
    }
  });

  it('reuses the installed shared dependency instead of replacing it with the newer frozen version', async () => {
    await installRootA(vi.fn());

    const shared13 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.3.0' });
    const rootC = buildPackage({
      name: '@platform-ai/root-c',
      skillId: 'sk_c',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.2.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.3.0', checksum: shared13.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-c',
            visibility: 'public',
            instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootC.bytes))
      .mockResolvedValueOnce(packageResponse(shared13.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'));

    await executeInstall('@platform-ai/root-c', installOptions(fetch));

    const lock = await loadSkillsLock(projectDir);
    // 已有副本优先：不因新根的冻锁而替换/升级共享依赖。
    expect(lock.skills['@platform-ai/shared#11111111-1111-4111-8111-111111111111'].version).toBe('1.2.0');
    expect(sharedStoreJson().version).toBe('1.2.0');
    const skillsJson = await loadSkillsJson(projectDir);
    expect(Object.keys(skillsJson.skills).sort()).toEqual([
      '@platform-ai/root-a',
      '@platform-ai/root-c'
    ]);
    expect(lock.skills['@platform-ai/root-a#11111111-1111-4111-8111-111111111111'].version).toBe('1.0.0');
  });

  it('installs the new root when its range is above the installed shared version, warning without downgrading or failing', async () => {
    // A 用 ~1.2.0 钉住 shared 1.2.0；C 声明 ^1.3.0（高于已装版本），消费端只提示。
    const shared12 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const rootA = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '~1.2.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared12.checksum } }
    });
    await executeInstall(
      '@platform-ai/root-a',
      installOptions(
        vi
          .fn()
          .mockResolvedValueOnce(
            ok({
              json: async () => ({
                name: '@platform-ai/root-a',
                visibility: 'public',
                instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'],
                packageUrl: `/api/packages/sk_a/1.0.0/${rootA.checksum}.json`
              })
            })
          )
          .mockResolvedValueOnce(packageResponse(rootA.bytes))
          .mockResolvedValueOnce(packageResponse(shared12.bytes))
          .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'))
      )
    );

    const shared13 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.3.0' });
    const rootC = buildPackage({
      name: '@platform-ai/root-c',
      skillId: 'sk_c',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.3.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.3.0', checksum: shared13.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-c',
            visibility: 'public',
            instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootC.bytes))
      .mockResolvedValueOnce(packageResponse(shared13.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await executeInstall('@platform-ai/root-c', installOptions(fetch));

      // 消费端范围差异只诊断：C 装上，shared 仍是 1.2.0，不擅自降级/替换。
      const skillsJson = await loadSkillsJson(projectDir);
      expect(Object.keys(skillsJson.skills).sort()).toEqual([
        '@platform-ai/root-a',
        '@platform-ai/root-c'
      ]);
      const lock = await loadSkillsLock(projectDir);
      expect(lock.skills['@platform-ai/shared#11111111-1111-4111-8111-111111111111'].version).toBe('1.2.0');
      expect(sharedStoreJson().version).toBe('1.2.0');
      const warning = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(warning).toContain('@platform-ai/shared@1.2.0');
      expect(warning).toContain('^1.3.0');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('installs dependencies declared by the actually adopted existing version', async () => {
    // 直接安装 shared 1.2.0，然后模拟该版本声明了 extra（发布冻锁里没有 extra）。
    const extra = buildPackage({ name: '@platform-ai/extra', skillId: 'sk_extra', version: '1.0.0' });
    const shared12 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    await executeInstall(
      '@platform-ai/shared',
      installOptions(
        vi
          .fn()
          .mockResolvedValueOnce(
            ok({
              json: async () => ({
                name: '@platform-ai/shared',
                visibility: 'public',
                instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.2.0'],
                packageUrl: `/api/packages/sk_shared/1.2.0/${shared12.checksum}.json`
              })
            })
          )
          .mockResolvedValueOnce(packageResponse(shared12.bytes))
      )
    );
    const installedSharedJson = path.join(
      projectDir,
      '.eslib',
      'skills',
      '11111111-1111-4111-8111-111111111111',
      '@platform-ai',
      'shared',
      'skill.json'
    );
    const installedShared = JSON.parse(fs.readFileSync(installedSharedJson, 'utf8'));
    installedShared.dependencies = { '@platform-ai/extra': '^1.0.0' };
    fs.writeFileSync(installedSharedJson, JSON.stringify(installedShared));

    // 新根 C 的冻锁要求 shared 1.3.0；已有 1.2.0 被复用，因此必须按 1.2.0
    // 自己的声明补齐 extra，而不是用 1.3.0 的子图冒充完整。
    const shared13 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.3.0' });
    const rootC = buildPackage({
      name: '@platform-ai/root-c',
      skillId: 'sk_c',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.3.0', checksum: shared13.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-c',
            visibility: 'public',
            instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootC.bytes))
      .mockResolvedValueOnce(packageResponse(shared13.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/extra',
          visibility: 'public',
          instanceId: '11111111-1111-4111-8111-111111111111',
          versions: ['1.0.0'],
          releases: [{ version: '1.0.0', packageUrl: `/api/packages/sk_extra/1.0.0/${extra.checksum}.json` }]
        })
      })
      .mockResolvedValueOnce(packageResponse(extra.bytes));

    await executeInstall('@platform-ai/root-c', installOptions(fetch));

    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@platform-ai/extra#11111111-1111-4111-8111-111111111111'].version).toBe('1.0.0');
    expect(
      fs.existsSync(
        path.join(projectDir, '.eslib', 'skills', '11111111-1111-4111-8111-111111111111', '@platform-ai', 'extra', 'SKILL.md')
      )
    ).toBe(true);
  });

  it('does not install an unused higher version’s subgraph under the adopted lower version', async () => {
    // 直接装 shared 1.2.0，并声明 extra ^1.0.0；root-c 的冻锁来自 shared 1.3.0，
    // 其中 extra 被锁在 2.0.0（不满足 1.2.0 的实际声明）。
    const shared12 = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    await executeInstall(
      '@platform-ai/shared',
      installOptions(
        vi
          .fn()
          .mockResolvedValueOnce(
            ok({
              json: async () => ({
                name: '@platform-ai/shared',
                visibility: 'public',
                instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.2.0'],
                packageUrl: `/api/packages/sk_shared/1.2.0/${shared12.checksum}.json`
              })
            })
          )
          .mockResolvedValueOnce(packageResponse(shared12.bytes))
      )
    );
    const sharedDir = path.join(projectDir, '.eslib', 'skills', '11111111-1111-4111-8111-111111111111', '@platform-ai', 'shared');
    const sharedJson = JSON.parse(fs.readFileSync(path.join(sharedDir, 'skill.json'), 'utf8'));
    sharedJson.dependencies = { '@platform-ai/extra': '^1.0.0' };
    fs.writeFileSync(path.join(sharedDir, 'skill.json'), JSON.stringify(sharedJson));

    const extra20 = buildPackage({ name: '@platform-ai/extra', skillId: 'sk_extra', version: '2.0.0' });
    const extra15 = buildPackage({ name: '@platform-ai/extra', skillId: 'sk_extra', version: '1.5.0' });
    const shared13 = buildPackage({
      name: '@platform-ai/shared',
      skillId: 'sk_shared',
      version: '1.3.0',
      dependencies: { '@platform-ai/extra': '^2.0.0' },
      dependencyLock: { '@platform-ai/extra': { skillId: 'sk_extra', version: '2.0.0', checksum: extra20.checksum } }
    });
    const rootC = buildPackage({
      name: '@platform-ai/root-c',
      skillId: 'sk_c',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.0.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.3.0', checksum: shared13.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-c',
            visibility: 'public',
            instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_c/1.0.0/${rootC.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(rootC.bytes))
      .mockResolvedValueOnce(packageResponse(shared13.bytes))
      .mockResolvedValueOnce(packageResponse(extra20.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'public'))
      .mockResolvedValueOnce(infoResponse('@platform-ai/extra', 'public'))
      // 实际声明 ^1.0.0 不接受冻锁中的 2.0.0，按 Registry 重新解析到 1.5.0。
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: '@platform-ai/extra',
          visibility: 'public',
          instanceId: '11111111-1111-4111-8111-111111111111',
          versions: ['2.0.0', '1.5.0'],
          releases: [{ version: '1.5.0', packageUrl: `/api/packages/sk_extra/1.5.0/${extra15.checksum}.json` }]
        })
      })
      .mockResolvedValueOnce(packageResponse(extra15.bytes));

    await executeInstall('@platform-ai/root-c', installOptions(fetch));

    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@platform-ai/extra#11111111-1111-4111-8111-111111111111'].version).toBe('1.5.0');
    expect(lock.skills['@platform-ai/shared#11111111-1111-4111-8111-111111111111'].version).toBe('1.2.0');
  });

  it('fails a public root whose chain contains a private dependency', async () => {
    const shared = buildPackage({ name: '@platform-ai/shared', skillId: 'sk_shared', version: '1.2.0' });
    const root = buildPackage({
      name: '@platform-ai/root-a',
      skillId: 'sk_a',
      version: '1.0.0',
      dependencies: { '@platform-ai/shared': '^1.2.0' },
      dependencyLock: { '@platform-ai/shared': { skillId: 'sk_shared', version: '1.2.0', checksum: shared.checksum } }
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          json: async () => ({
            name: '@platform-ai/root-a',
            visibility: 'public',
            instanceId: '11111111-1111-4111-8111-111111111111', versions: ['1.0.0'],
            packageUrl: `/api/packages/sk_a/1.0.0/${root.checksum}.json`
          })
        })
      )
      .mockResolvedValueOnce(packageResponse(root.bytes))
      .mockResolvedValueOnce(packageResponse(shared.bytes))
      .mockResolvedValueOnce(infoResponse('@platform-ai/shared', 'private'));

    await expect(executeInstall('@platform-ai/root-a', installOptions(fetch))).rejects.toMatchObject({
      code: 'releaseDependencyPublicChainMustBePublic'
    });
    expect(fs.existsSync(path.join(projectDir, '.eslib', 'skills', '11111111-1111-4111-8111-111111111111', '@platform-ai', 'shared'))).toBe(false);
  });
});
