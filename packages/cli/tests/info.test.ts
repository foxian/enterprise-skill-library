import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeInfo, formatSkillInfo } from '../src/commands/info.js';
import { readCliVersion } from '../src/version.js';

// 请求上报（#136）：期望的 User-Agent 精确格式。
function expectedUserAgent(): string {
  return `esl/${readCliVersion()} node/${process.version.replace(/^v/, '')} ${process.platform}/${process.arch}`;
}

describe('esl info output', () => {
  it('lists versions newest first regardless of the order they arrive in', () => {
    const output = formatSkillInfo({
      name: '@alice/code-review',
      description: 'Review code',
      versions: ['1.0.0', '1.10.0', '1.9.0']
    });

    expect(output).toContain(
      ['Versions:', '  1.10.0  0 downloads', '  1.9.0  0 downloads', '  1.0.0  0 downloads'].join('\n')
    );
  });

  it('prints the total download count and one line per version with that version count (#137)', () => {
    const output = formatSkillInfo({
      name: '@alice/code-review',
      description: 'Review code',
      downloadCount: 8,
      versions: ['1.0.0', '2.0.0'],
      releases: [
        { version: '2.0.0', checksum: 'sha256-b', downloadCount: 3 },
        { version: '1.0.0', checksum: 'sha256-a', downloadCount: 5 }
      ]
    });

    expect(output).toContain('Downloads: 8');
    expect(output).toContain(
      ['Versions:', '  2.0.0  3 downloads', '  1.0.0  5 downloads'].join('\n')
    );
  });

  it('renders a version with no matching release as 0 downloads (#137)', () => {
    const output = formatSkillInfo({
      name: '@alice/code-review',
      versions: ['2.0.0', '1.0.0'],
      releases: [{ version: '2.0.0', checksum: 'sha256-b', downloadCount: 3 }]
    });

    expect(output).toContain(
      ['Versions:', '  2.0.0  3 downloads', '  1.0.0  0 downloads'].join('\n')
    );
  });

  it('omits the total download count when the server did not report one', () => {
    const output = formatSkillInfo({
      name: '@builtin/esl-operator',
      versions: ['0.1.0']
    });

    expect(output).not.toContain('Downloads:');
  });
});

describe('esl info authentication', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-info-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('sends the stored token with the info request when credentials exist', async () => {
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/code-review', versions: ['1.0.0'] })
    });

    await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40acme%2Fcode-review',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'token gitea-token' })
      })
    );
  });

  it('stays anonymous when no credentials exist', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/code-review', versions: ['1.0.0'] })
    });

    await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40acme%2Fcode-review',
      expect.objectContaining({
        headers: expect.not.objectContaining({ authorization: expect.anything() })
      })
    );
  });

  it('stays anonymous when the stored login is expired', async () => {
    await initializeLocalStore({ homeDir });
    const expiredLoginAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await saveCredentials({ token: 'gitea-token', loginAt: expiredLoginAt }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/code-review', versions: ['1.0.0'] })
    });

    await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40acme%2Fcode-review',
      expect.objectContaining({
        headers: expect.not.objectContaining({ authorization: expect.anything() })
      })
    );
  });

  it('wraps a 403 with cross-account guidance', async () => {
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"error":"Forbidden: read access required"}'
    });

    const error = await executeInfo('@acme/private-skill', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(error).not.toBeNull();
    expect(error!.message).toContain('Failed to fetch skill info: {"error":"Forbidden: read access required"}');
    expect(error!.message).toMatch(/maintained by another account or organization/);
    expect(error!.message).toMatch(/esl login/);
  });

  it('leaves non-403 failures unadorned', async () => {
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom'
    });

    await expect(
      executeInfo('@acme/code-review', {
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow(/^Failed to fetch skill info: boom$/);
  });
});

describe('esl info download counts (#137)', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-info-dl-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function mockInfoFetch() {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: '@acme/code-review',
        description: 'Review code',
        downloadCount: 8,
        versions: ['1.0.0', '2.0.0'],
        releases: [
          { version: '2.0.0', checksum: 'sha256-b', downloadCount: 3 },
          { version: '1.0.0', checksum: 'sha256-a', downloadCount: 5 }
        ]
      })
    });
  }

  it('human output shows the total and one line per version with its download count', async () => {
    const fetchImpl = mockInfoFetch();

    const info = await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });
    const output = formatSkillInfo(info);

    expect(output).toContain('Downloads: 8');
    expect(output).toContain(
      ['Versions:', '  2.0.0  3 downloads', '  1.0.0  5 downloads'].join('\n')
    );
    // 版本列表契约不变：仍是 string[]（喂给安装时的版本选择）。
    expect(info.versions).toEqual(['1.0.0', '2.0.0']);
  });

  it('--json output carries the total and per-version download counts', async () => {
    const fetchImpl = mockInfoFetch();

    const info = await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });
    // --json 直接 JSON.stringify(info)，因此断言序列化后的字段。
    const parsed = JSON.parse(JSON.stringify(info)) as {
      downloadCount: number;
      releases: Array<{ version: string; downloadCount: number }>;
    };

    expect(parsed.downloadCount).toBe(8);
    expect(parsed.releases).toEqual([
      { version: '2.0.0', checksum: 'sha256-b', downloadCount: 3 },
      { version: '1.0.0', checksum: 'sha256-a', downloadCount: 5 }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40acme%2Fcode-review',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'token gitea-token' })
      })
    );
  });
});

describe('esl request reporting (#136)', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-report-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('sends the exact User-Agent alongside Authorization on an info request, without ?requested=', async () => {
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/code-review', versions: ['1.0.0'] })
    });

    await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    // 非包请求（info）不带 ?requested=。
    expect(url).toBe('http://localhost:3000/api/skills/%40acme%2Fcode-review');
    expect(url).not.toContain('requested=');
    expect(init.headers['user-agent']).toBe(expectedUserAgent());
    expect(init.headers.authorization).toBe('token gitea-token');
  });
});
