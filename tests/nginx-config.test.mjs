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
});
