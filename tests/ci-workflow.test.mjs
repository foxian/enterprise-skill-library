import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import semver from 'semver';
import { describe, expect, it } from 'vitest';

// ADR-0051 / ADR-0053：支持契约 = CI 矩阵（版本轴 + OS 轴）。
// 这里断言工作流的矩阵结构与 engines 区间，防止契约在无人察觉时漂移。
const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));

function cliMatrixEntries() {
  return workflow.jobs.cli.strategy.matrix.include;
}

function serverMatrixEntries() {
  const matrix = workflow.jobs.server.strategy.matrix;
  if (matrix.include) return matrix.include;
  return matrix['node-version'].map((nodeVersion) => ({ os: workflow.jobs.server['runs-on'], nodeVersion }));
}

describe('CI 矩阵（ADR-0053 平台支持矩阵）', () => {
  it('CLI job 在 ubuntu 上保留 Node 20.17 / 22 / 24 三轴', () => {
    const ubuntuNodes = cliMatrixEntries()
      .filter((entry) => entry.os === 'ubuntu-latest')
      .map((entry) => String(entry['node-version']));
    expect(ubuntuNodes).toEqual(['20.17', '22', '24']);
  });

  it('CLI job 覆盖 windows 与 macOS（各一个 Node 24 job）', () => {
    const entries = cliMatrixEntries();
    const osList = entries.map((entry) => entry.os);
    expect(osList).toContain('windows-latest');
    expect(osList).toContain('macos-latest');
    expect(entries.filter((entry) => entry.os === 'windows-latest').map((entry) => String(entry['node-version'])))
      .toEqual(['24']);
    expect(entries.filter((entry) => entry.os === 'macos-latest').map((entry) => String(entry['node-version'])))
      .toEqual(['24']);
  });

  it('server job 维持 ubuntu-only（服务端 Windows 仅 Docker Desktop 形态，ADR-0053）', () => {
    const entries = serverMatrixEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.os).toBe('ubuntu-latest');
    }
  });

  it('CLI 构建步骤引用改名后的 workspace @foxian/esl', () => {
    const steps = workflow.jobs.cli.steps.map((step) => step.run ?? '').join('\n');
    expect(steps).toContain('--workspace @foxian/esl');
    expect(steps).not.toContain('--workspace @esl/cli');
  });

  it('本契约测试自身被 CI vitest 步骤执行（防守卫漂移出门禁）', () => {
    const vitestSteps = workflow.jobs.cli.steps
      .map((step) => step.run ?? '')
      .filter((run) => run.includes('vitest run'));
    expect(vitestSteps.some((run) => run.includes('tests/ci-workflow.test.mjs'))).toBe(true);
  });
});

describe('@foxian/esl engines.node（ADR-0051 支持名单）', () => {
  const pkg = JSON.parse(readFileSync(new URL('../packages/cli/package.json', import.meta.url), 'utf8'));
  const range = pkg.engines?.node;

  it('声明了 engines.node', () => {
    expect(typeof range).toBe('string');
  });

  it('放行官方支持的 Node 版本（20.17+ / 22.13+ / 23.5+ / 24.x）', () => {
    expect(semver.satisfies('20.17.0', range)).toBe(true);
    expect(semver.satisfies('22.13.0', range)).toBe(true);
    expect(semver.satisfies('23.5.0', range)).toBe(true);
    expect(semver.satisfies('24.10.0', range)).toBe(true);
  });

  it('不放行低于下限的版本', () => {
    expect(semver.satisfies('20.16.0', range)).toBe(false);
    expect(semver.satisfies('22.12.0', range)).toBe(false);
  });

  it('不放行 ADR-0051 明确不支持的 Node 25 / 26（Current 不算支持）', () => {
    expect(semver.satisfies('25.0.0', range)).toBe(false);
    expect(semver.satisfies('26.0.0', range)).toBe(false);
  });
});
