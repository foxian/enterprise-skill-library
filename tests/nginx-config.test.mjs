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
      /server_name esl\.example\.com[\s\S]*?location\s+=\s+\/\s*\{[^}]*return\s+302\s+\/admin\/login;/
    );
  });

  it('redirects the example www root and admin console to the example cloud origin', () => {
    // ADR-0058：公开仓库只保留占位域名示例，真实站点路由在私有实例中配置。
    expect(nginxConfig).toMatch(
      /server_name www\.esl\.example\.com;[\s\S]*?location\s+=\s+\/\s*\{[^}]*return\s+302\s+https:\/\/cloud\.esl\.example\.com\/admin\/login;/
    );
    expect(nginxConfig).toMatch(
      /server_name www\.esl\.example\.com;[\s\S]*?location\s+\/admin\s*\{[^}]*return\s+302\s+https:\/\/cloud\.esl\.example\.com\$request_uri;/
    );
  });

  it('emits relative redirects so the external host:port is preserved', () => {
    // 默认 absolute_redirect 会用不含端口的 $host 拼绝对地址，把 :3000 丢掉。
    expect(nginxConfig).toContain('absolute_redirect off;');
  });
});
