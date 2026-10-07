import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const nginxConfig = fs.readFileSync(
  path.resolve(process.cwd(), 'docker/nginx.conf'),
  'utf8'
);

describe('Nginx default server configuration', () => {
  it('loads the standard MIME map so ES modules are served as JavaScript', () => {
    expect(nginxConfig).toContain('include /etc/nginx/mime.types;');
  });

  it('uses a default server with no bound domain (localhost / IP works out of the box)', () => {
    // ADR-0058：产品层不绑定任何域名，任意 hostname 都经 default_server 处理。
    expect(nginxConfig).toMatch(
      /listen\s+80\s+default_server;[\s\S]*?server_name\s+_;/
    );
  });

  it('redirects the root path to the skill-library login page', () => {
    // 单入口 ADR-0004：访问 / 应直达认证入口（注册在登录页内）。
    expect(nginxConfig).toMatch(
      /location\s+=\s+\/\s*\{[^}]*return\s+302\s+\/admin\/login;/
    );
  });

  it('emits relative redirects so the external host:port is preserved', () => {
    // 默认 absolute_redirect 会用不含端口的 $host 拼绝对地址，把 :3000 丢掉。
    expect(nginxConfig).toContain('absolute_redirect off;');
  });

  it('includes instance-level custom routes from conf.d', () => {
    // ADR-0060：实例层在 nginx-conf.d/ 中添加 .conf，具体 server_name 优先于 default_server。
    expect(nginxConfig).toContain('include /etc/nginx/conf.d/*.conf;');
  });
});
