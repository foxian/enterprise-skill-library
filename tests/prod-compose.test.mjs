import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// 经真实 docker compose 解析器取 base + 生产 override 的合并视图，
// 而不是在测试里模拟 merge 语义（compose 对 ports 等序列有特殊合并规则）。
function mergedProdConfig(env = {}) {
  return spawnSync(
    'docker',
    [
      'compose',
      '-f', 'docker-compose.yml',
      '-f', 'docker-compose.prod.yml',
      'config', '--format', 'json'
    ],
    { encoding: 'utf8', env: { ...process.env, ...env } }
  );
}

describe('生产 compose override', () => {
  it('不发布 Git Backend 直连端口（宿主 3001 仅开发/E2E 使用，ADR-0004）', () => {
    const result = mergedProdConfig();
    expect(result.status, result.stderr).toBe(0);

    const config = JSON.parse(result.stdout);
    const giteaPorts = config.services.gitea.ports ?? [];
    const published = giteaPorts.map((port) => port.published);
    expect(published).toEqual([]);
  });

  it('Git Backend ROOT_URL 跟随 ESL_SERVER_URL 指向生产对外地址', () => {
    const result = mergedProdConfig({ ESL_SERVER_URL: 'http://esl.example.com' });
    expect(result.status, result.stderr).toBe(0);

    const config = JSON.parse(result.stdout);
    expect(config.services.gitea.environment.GITEA__server__ROOT_URL)
      .toBe('http://esl.example.com/git/');
  });

  it('ESL Server 前端烤入镜像：构建 web 生产镜像且不再 bind-mount dist 与 nginx.conf', () => {
    const result = mergedProdConfig();
    expect(result.status, result.stderr).toBe(0);

    const server = JSON.parse(result.stdout).services.server;
    expect(server.build.dockerfile).toBe('docker/web.Dockerfile');
    const bindMounts = (server.volumes ?? [])
      .filter((volume) => volume.type === 'bind')
      .map((volume) => volume.source);
    expect(bindMounts).toEqual([]);
  });
});
