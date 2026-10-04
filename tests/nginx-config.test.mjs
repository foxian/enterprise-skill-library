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

  it('redirects the site root to the skill-library login page', () => {
    // 单入口 ADR-0004：对外只暴露 3000，访问 / 应直达认证入口（注册在登录页内）。
    expect(nginxConfig).toMatch(/location\s+=\s+\/\s*\{[^}]*return\s+302\s+\/admin\/login;/);
  });

  it('emits relative redirects so the external host:port is preserved', () => {
    // 默认 absolute_redirect 会用不含端口的 $host 拼绝对地址，把 :3000 丢掉。
    expect(nginxConfig).toContain('absolute_redirect off;');
  });
});
