import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const nginxConfig = fs.readFileSync(
  path.resolve(process.cwd(), 'docker/nginx.conf'),
  'utf8'
);

describe('Nginx static asset configuration', () => {
  it('loads the standard MIME map so ES modules are served as JavaScript', () => {
    expect(nginxConfig).toContain('include /etc/nginx/mime.types;');
  });

  it('redirects cloud/localhost root to the skill-library login page', () => {
    // 单入口 ADR-0004：cloud/localhost 访问 / 应直达认证入口（注册在登录页内）。
    expect(nginxConfig).toMatch(
      /server_name enterprise-skills\.com[\s\S]*?location\s+=\s+\/\s*\{[^}]*return\s+302\s+\/admin\/login;/
    );
  });

  it('redirects www root and admin console to the cloud origin', () => {
    // ADR-0058：www 是官网入口；尚无主页前临时导向 cloud，避免继续充当控制台。
    expect(nginxConfig).toMatch(
      /server_name www\.enterprise-skills\.com;[\s\S]*?location\s+=\s+\/\s*\{[^}]*return\s+302\s+https:\/\/cloud\.enterprise-skills\.com\/admin\/login;/
    );
    expect(nginxConfig).toMatch(
      /server_name www\.enterprise-skills\.com;[\s\S]*?location\s+\/admin\s*\{[^}]*return\s+302\s+https:\/\/cloud\.enterprise-skills\.com\$request_uri;/
    );
  });

  it('emits relative redirects so the external host:port is preserved', () => {
    // 默认 absolute_redirect 会用不含端口的 $host 拼绝对地址，把 :3000 丢掉。
    expect(nginxConfig).toContain('absolute_redirect off;');
  });
});
