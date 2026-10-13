import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { createProgram, formatSearchLine, run, runSearchSession } from '../src/bin/esl.js';
import { executeSearch, type SkillSearchResult } from '../src/commands/search.js';

// 下载量展示（#137）：搜索结果的非交互行、交互式选项标签与详情，以及 --json 载荷。
const tool: SkillSearchResult = {
  name: '@acme/tool',
  displayName: 'Tool',
  skillName: 'tool',
  description: 'Org tool',
  latestStableVersion: '1.0.0',
  visibility: 'public',
  downloadCount: 42
};

describe('esl search download count (#137)', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-search-dl-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'skill-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('renders the tab-separated line with downloadCount immediately before the trailing description', () => {
    const columns = formatSearchLine(tool).split('\t');

    // 列顺序契约：name / displayName / latestStableVersion / visibility / downloadCount / description。
    expect(columns).toEqual(['@acme/tool', 'Tool', '1.0.0', 'public', '42', 'Org tool']);
    // description 是唯一变长的自由文本，固定最后一列。
    expect(columns.at(-1)).toBe('Org tool');
  });

  it('includes the download count in the interactive choice label', async () => {
    const selectMock = vi.fn().mockResolvedValue('__exit__');

    await runSearchSession(createProgram(), {}, {
      search: async () => [tool],
      select: selectMock as any
    });

    const list = selectMock.mock.calls[0][0] as { choices: Array<{ name: string; value: string }> };
    const label = list.choices.find((choice) => choice.value === '@acme/tool')?.name;
    expect(label).toContain('42 downloads');
  });

  it('prints the download count in the search details view', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const selectMock = vi
      .fn()
      .mockResolvedValueOnce('@acme/tool')
      .mockResolvedValueOnce('details')
      .mockResolvedValueOnce('__exit__');

    try {
      await runSearchSession(createProgram(), {}, {
        search: async () => [tool],
        select: selectMock as any
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.join('\n')).toContain('Downloads: 42');
  });

  it('esl search --json output includes downloadCount per result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          name: '@acme/tool',
          description: 'Org tool',
          displayName: 'Tool',
          latestStableVersion: '1.0.0',
          visibility: 'public',
          downloadCount: 42
        }
      ]
    });

    const results = await executeSearch('tool', {
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any
    });

    // --json 分支直接 JSON.stringify(results)；断言结构化载荷带上 downloadCount。
    const parsed = JSON.parse(JSON.stringify(results, null, 2)) as Array<{ name: string; downloadCount: number }>;
    expect(parsed).toEqual([expect.objectContaining({ name: '@acme/tool', downloadCount: 42 })]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://localhost:3000/api/skills/search?q=tool');
    expect(init.headers.authorization).toBe('token skill-token');
  });

  it('prints downloadCount in the non-interactive search stdout line', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          name: '@acme/tool',
          description: 'Org tool',
          displayName: 'Tool',
          latestStableVersion: '1.0.0',
          visibility: 'public',
          downloadCount: 42
        }
      ]
    });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    // 通过 CLI 入口端到端跑：HOME 指向临时 Store，全局 fetch 换成桩。
    vi.stubEnv('HOME', homeDir);
    vi.stubGlobal('fetch', fetchImpl);

    try {
      await run(['node', 'esl', 'search', 'tool', '--no-input', '--server', 'http://localhost:3000']);
    } finally {
      logSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    const line = logs.find((entry) => entry.includes('@acme/tool'));
    expect(line).toBeDefined();
    expect(line!.split('\t')).toEqual(['@acme/tool', 'Tool', '1.0.0', 'public', '42', 'Org tool']);
  });

  it('prints downloadCount per result in esl search --json stdout', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          name: '@acme/tool',
          description: 'Org tool',
          displayName: 'Tool',
          latestStableVersion: '1.0.0',
          visibility: 'public',
          downloadCount: 42
        }
      ]
    });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.stubEnv('HOME', homeDir);
    vi.stubGlobal('fetch', fetchImpl);

    try {
      await run(['node', 'esl', 'search', 'tool', '--json', '--server', 'http://localhost:3000']);
    } finally {
      logSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    const payload = logs.find((entry) => entry.trim().startsWith('['));
    expect(payload).toBeDefined();
    expect(JSON.parse(payload!)).toEqual([
      expect.objectContaining({ name: '@acme/tool', downloadCount: 42 })
    ]);
  });
});
