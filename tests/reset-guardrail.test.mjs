import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..');
const scriptPath = join(repoRoot, 'scripts', 'reset-dev-env.mjs');

// Bootstrap Reset 仅开发/测试环境可用（ADR-0018/0047）：生产环境必须拒绝。
// 为使 RED 阶段（护栏缺失时）脚本不会真实执行 docker compose down，
// 以空 PATH 运行——护栏的判定发生在任何 docker 调用之前，不受影响。
function runResetInProduction(extraEnv = {}) {
  return spawnSync(
    process.execPath,
    [scriptPath, '--yes', '--data-dir', dataDir],
    {
      encoding: 'utf8',
      env: { ESL_ENVIRONMENT: 'production', ...extraEnv, PATH: '' }
    }
  );
}

const tempRoot = join(tmpdir(), `esl-reset-guard-${process.pid}-${Date.now()}`);
const dataDir = join(tempRoot, 'data');
for (const [name, marker] of [
  ['api', 'esl.db'],
  ['gitea', 'git'],
  ['secrets', 'gitea-admin-token']
]) {
  const dir = join(dataDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, marker), '');
}

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('Bootstrap Reset 生产护栏', () => {
  it('ESL_ENVIRONMENT=production 时在任何破坏性操作前拒绝执行', () => {
    const result = runResetInProduction();
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    // 拒绝理由须是护栏本身，而非 docker 缺失等意外错误
    expect(output).toContain('ESL_ENVIRONMENT');
    expect(output).toContain('production');
    // 备份恢复指引（CONTEXT.md：备份/恢复是生产唯一的"回到过去"手段）
    expect(output).toMatch(/backup|restore|备份|恢复/i);
    // 未触碰任何数据
    expect(existsSync(join(dataDir, 'api', 'esl.db'))).toBe(true);
    expect(existsSync(join(dataDir, 'gitea', 'git'))).toBe(true);
    expect(existsSync(join(dataDir, 'secrets', 'gitea-admin-token'))).toBe(true);
  });
});
