import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// .env.example 是生产部署的 env 模板（Issue #71）：必需变量齐全、
// 秘密项有标注、不残留已拆除的部署模式变量（ADR-0032）。
const envExample = fs.readFileSync(
  path.resolve(process.cwd(), '.env.example'),
  'utf8'
);

describe('.env.example 生产模板', () => {
  it('声明 ESL_ENVIRONMENT 并说明 production 触发 Bootstrap Reset 护栏', () => {
    expect(envExample).toMatch(/^ESL_ENVIRONMENT=/m);
    expect(envExample).toMatch(/production/);
  });

  it('声明 ESL_SERVER_URL 作为对外地址（默认本地开发）', () => {
    expect(envExample).toMatch(/^ESL_SERVER_URL=/m);
    expect(envExample).toMatch(/localhost/);
  });

  it('秘密项有明确标注（标注紧邻 GITEA_ADMIN_PASSWORD）', () => {
    expect(envExample).toMatch(/(秘密|secret)[^\n]*\nGITEA_ADMIN_PASSWORD=/i);
  });

  it('不残留 ADR-0032 已拆除的部署模式变量', () => {
    for (const stale of [
      'ESL_DEPLOYMENT_MODE',
      'ESL_DEFAULT_ORG',
      'ESL_ORG_ADMIN_PASSWORD',
      'ESL_APPLICATION_ENCRYPTION_KEY'
    ]) {
      expect(envExample, stale).not.toContain(stale);
    }
  });
});
