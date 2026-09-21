import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 启用 TLS 后 enable-tls.sh 用 nginx.tls.conf 整体替换镜像内的 nginx.conf
// （ADR-0047：TLS 是"加一个开关"而非改架构）。两份配置必须承载同一路由集，
// 否则 HTTPS 上线会静默丢失能力。这里断言 location 级路由集合一致。
const readNginx = (name) =>
  fs.readFileSync(path.resolve(process.cwd(), 'docker', name), 'utf8');

function extractLocations(config) {
  return [...config.matchAll(/location\s+([^\s{]+)\s*\{/g)].map((m) => m[1]).sort();
}

describe('nginx TLS 配置路由对齐', () => {
  const httpConfig = readNginx('nginx.conf');
  const tlsConfig = readNginx('nginx.tls.conf');

  it('TLS 配置存在且承载与 HTTP 配置一致的 location 路由集', () => {
    expect(extractLocations(httpConfig)).toEqual(extractLocations(tlsConfig));
  });

  it('TLS 配置启用 443 与证书（指向容器内挂载点）', () => {
    expect(tlsConfig).toContain('listen 443 ssl');
    expect(tlsConfig).toContain('/etc/nginx/tls/fullchain.pem');
    expect(tlsConfig).toContain('/etc/nginx/tls/privkey.pem');
  });

  it('HTTP 仅做到 HTTPS 的跳转（证书签发后不再明文服务）', () => {
    const port80Block = tlsConfig.match(/server\s*\{[\s\S]*?listen\s+80;[\s\S]*?\n\}/);
    expect(port80Block).not.toBeNull();
    expect(port80Block[0]).toContain('301');
  });
});
