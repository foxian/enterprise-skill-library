import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const config = fs.readFileSync(
  path.resolve(process.cwd(), 'docker/cloudflared/config.yml.example'),
  'utf8'
);

describe('Cloudflare Tunnel public entrypoints', () => {
  it('routes supported public hostnames to the local server and rejects others', () => {
    for (const hostname of [
      'enterprise-skills.com',
      'www.enterprise-skills.com',
      'cloud.enterprise-skills.com',
      'docs.enterprise-skills.com',
      'status.enterprise-skills.com'
    ]) {
      expect(config).toContain(`hostname: ${hostname}`);
    }
    expect(config).toContain('service: http://server:80');
    expect(config).toContain('service: http_status:404');
  });
});
