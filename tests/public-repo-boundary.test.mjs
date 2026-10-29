import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-0058 / ADR-0060 / Issue #121：公开仓库只维护可复用的产品层资产，
// 公开文档可标明公开云端默认地址，但不得包含其他具体实例域名、生产 Secret、Token、密钥或生产服务器地址。
// 域名、TLS、Tunnel 等私有实例配置通过 gitignore 的本地文件注入。
// 本测试扫描公开配置与文档，确保私有实例信息不会重新进入公开仓库。
//
// ADR-0060 / ADR-0068 修订（2026-10）：项目主页是产品层公开信息，允许出现在
// 公开文档（如 README）；该例外不适用于产品配置，cloud 仍是 CLI 唯一硬编码默认 Server。

const repoRoot = path.resolve(process.cwd());

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// 公开 CLI 默认地址是允许的，其他 enterprise-skills.com 域名仍按具体实例地址拦截。
const PUBLIC_DEFAULT_SERVER_URL = 'https://cloud.enterprise-skills.com/';
// 项目主页属产品层公开信息，仅允许出现在公开文档中（ADR-0060 / ADR-0068 修订）。
const PUBLIC_PROJECT_WEBSITE_URL = 'https://www.enterprise-skills.com';
const REAL_INSTANCE_DOMAIN_PATTERN = /enterprise-skills\.com/i;

function expectNoPrivateInstanceDomain(content, file, { allowProjectWebsite = false } = {}) {
  let sanitized = content.replaceAll(PUBLIC_DEFAULT_SERVER_URL, '');
  if (allowProjectWebsite) {
    sanitized = sanitized.replaceAll(PUBLIC_PROJECT_WEBSITE_URL, '');
  }
  expect(sanitized, `${file} 中不应出现其他具体实例域名`).not.toMatch(REAL_INSTANCE_DOMAIN_PATTERN);
}

// 需要扫描的公开配置文件
const PUBLIC_CONFIG_FILES = [
  '.env.example',
  'docker/nginx.conf',
];

// 需要扫描的核心文档与技能文件
const PUBLIC_DOC_FILES = [
  'CONTEXT.md',
  'README.md',
  'README.zh-CN.md',
  'docs/adr/0068-domain-and-service-entrypoints.md',
  'docs/adr/0060-public-product-and-private-instance-boundary.md',
  'docs/guides/production-deployment.md',
  'docs/guides/usage.md',
  'skills/esl-operator/SKILL.md',
  'skills/esl-operator/references/setup.md',
];

// 不应该出现在公开配置示例中的硬编码敏感值
const SUSPICIOUS_SECRET_PATTERNS = [
  // GITEA_ADMIN_PASSWORD 必须是示例值，不能是真实强密码
  {
    name: '硬编码 GITEA_ADMIN_PASSWORD 真实值',
    pattern: /^GITEA_ADMIN_PASSWORD\s*=\s*(?!change-this-admin-password|change|REPLACE|示例|example|<).{16,}/im,
  },
  // ESL_EMAIL_ACTION_SECRET 必须是示例值
  {
    name: '硬编码 ESL_EMAIL_ACTION_SECRET 真实值',
    pattern: /^ESL_EMAIL_ACTION_SECRET\s*=\s*(?!change-this-to-a-long-random-secret|change|REPLACE|示例|example|<).{40,}/im,
  },
];

describe('公开仓库产品边界 — 配置文件不含具体实例域名', () => {
  for (const file of PUBLIC_CONFIG_FILES) {
    it(`${file} 不包含非默认的具体实例域名`, () => {
      expectNoPrivateInstanceDomain(readRepoFile(file), file);
    });
  }

  it('Nginx 默认服务不绑定具体域名（default_server + server_name _）', () => {
    const nginxConf = readRepoFile('docker/nginx.conf');
    expect(nginxConf).toMatch(/listen\s+80\s+default_server;/);
    expect(nginxConf).toMatch(/server_name\s+_;/);
  });

  it('Nginx 保留专用 instance-conf include 供实例层注入自定义路由', () => {
    const nginxConf = readRepoFile('docker/nginx.conf');
    expect(nginxConf).toContain('include /etc/nginx/instance-conf/*.conf;');
  });

  it('.env.example 使用 localhost 作为默认 ESL_SERVER_URL', () => {
    const envExample = readRepoFile('.env.example');
    expect(envExample).toMatch(/^ESL_SERVER_URL=http:\/\/localhost:4070/m);
  });
});

describe('公开仓库产品边界 — 核心文档不含其他具体实例域名', () => {
  for (const file of PUBLIC_DOC_FILES) {
    it(`${file} 不包含非默认的具体实例域名`, () => {
      expectNoPrivateInstanceDomain(readRepoFile(file), file, { allowProjectWebsite: true });
    });
  }

  it('README 说明公开云端默认 Server 地址', () => {
    expect(readRepoFile('README.md')).toContain(PUBLIC_DEFAULT_SERVER_URL);
  });

  it('README 链接项目主站，但不作为 CLI 默认 Server', () => {
    const readme = readRepoFile('README.md');
    expect(readme).toContain(PUBLIC_PROJECT_WEBSITE_URL);
    expect(readme).toContain(PUBLIC_DEFAULT_SERVER_URL);
  });
});

describe('公开仓库产品边界 — 配置示例不含硬编码生产 Secret', () => {
  const envExample = readRepoFile('.env.example');

  it('GITEA_ADMIN_PASSWORD 使用示例值', () => {
    expect(envExample).toMatch(/GITEA_ADMIN_PASSWORD=change-this-admin-password/);
  });

  for (const { name, pattern } of SUSPICIOUS_SECRET_PATTERNS) {
    it(`.env.example 不含 ${name}`, () => {
      expect(envExample, name).not.toMatch(pattern);
    });
  }
});

describe('公开仓库产品边界 — 术语与 ADR-0060 一致', () => {
  it('ADR-0060 存在且声明产品层/实例层分离', () => {
    const adr060 = readRepoFile('docs/adr/0060-public-product-and-private-instance-boundary.md');
    expect(adr060).toContain('产品层');
    expect(adr060).toContain('实例层');
    expect(adr060).toContain('私有部署仓库');
    expect(adr060).toContain('上游版本');
  });

  it('CONTEXT.md 包含产品层、实例层、私有部署仓库和上游版本术语', () => {
    const context = readRepoFile('CONTEXT.md');
    expect(context).toContain('产品层');
    expect(context).toContain('实例层');
    expect(context).toContain('私有部署仓库');
    expect(context).toContain('上游版本');
  });
});
