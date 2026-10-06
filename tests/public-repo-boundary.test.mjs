import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-0058 / ADR-0060 / Issue #121：公开仓库只维护可复用的产品层资产，
// 不得包含真实实例域名、生产 Secret、Token、密钥或生产服务器地址。
// 本测试扫描公开配置与文档，确保私有实例信息不会重新进入公开仓库。

const repoRoot = path.resolve(process.cwd());

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// 真实实例域名模式（私有部署的域名，不得出现在公开仓库）
const REAL_INSTANCE_DOMAIN_PATTERN = /enterprise-skills\.com/i;

// 公开仓库应使用的占位域名（产品层示例）
const PLACEHOLDER_DOMAIN = 'esl.example.com';

// 需要扫描的公开配置文件列表
const PUBLIC_CONFIG_FILES = [
  '.env.example',
  'docker/nginx.conf',
  'docker/nginx.tls.conf',
  'docker/cloudflared/config.yml.example',
];

// 需要扫描的核心文档与技能文件
const PUBLIC_DOC_FILES = [
  'CONTEXT.md',
  'README.md',
  'docs/adr/0058-domain-and-service-entrypoints.md',
  'docs/adr/0060-public-product-and-private-instance-boundary.md',
  'docs/guides/production-deployment.md',
  'docs/guides/usage.md',
  'skills/esl-operator/SKILL.md',
  'skills/esl-operator/references/setup.md',
];

// 简单的 secret 模式：不应该出现在公开配置示例中的硬编码敏感值
const SUSPICIOUS_SECRET_PATTERNS = [
  // GITEA_ADMIN_PASSWORD 不应是真实强密码，必须是示例值
  {
    name: '硬编码 GITEA_ADMIN_PASSWORD 真实值',
    pattern: /^GITEA_ADMIN_PASSWORD\s*=\s*(?!change-this-admin-password|change|REPLACE|示例|example|<).{16,}/im,
  },
  // ESL_EMAIL_ACTION_SECRET 不应是真实密钥，必须是示例值
  {
    name: '硬编码 ESL_EMAIL_ACTION_SECRET 真实值',
    pattern: /^ESL_EMAIL_ACTION_SECRET\s*=\s*(?!change-this-to-a-long-random-secret|change|REPLACE|示例|example|<).{40,}/im,
  },
];

describe('公开仓库产品边界 — 配置文件不含真实实例域名', () => {
  for (const file of PUBLIC_CONFIG_FILES) {
    it(`${file} 不包含真实实例域名 enterprise-skills.com`, () => {
      const content = readRepoFile(file);
      expect(content, `${file} 中不应出现真实实例域名`).not.toMatch(REAL_INSTANCE_DOMAIN_PATTERN);
    });
  }

  it('Nginx 配置使用占位域名 esl.example.com', () => {
    const nginxConf = readRepoFile('docker/nginx.conf');
    expect(nginxConf).toContain(PLACEHOLDER_DOMAIN);
  });

  it('Nginx TLS 配置使用占位域名 esl.example.com', () => {
    const tlsConf = readRepoFile('docker/nginx.tls.conf');
    expect(tlsConf).toContain(PLACEHOLDER_DOMAIN);
  });

  it('Cloudflare Tunnel 示例配置使用占位域名 esl.example.com', () => {
    const tunnelConf = readRepoFile('docker/cloudflared/config.yml.example');
    expect(tunnelConf).toContain(PLACEHOLDER_DOMAIN);
  });

  it('.env.example 使用 localhost 作为默认 ESL_SERVER_URL', () => {
    const envExample = readRepoFile('.env.example');
    expect(envExample).toMatch(/^ESL_SERVER_URL=http:\/\/localhost:3000/m);
  });
});

describe('公开仓库产品边界 — 核心文档不含真实实例域名', () => {
  for (const file of PUBLIC_DOC_FILES) {
    it(`${file} 不包含真实实例域名 enterprise-skills.com`, () => {
      const content = readRepoFile(file);
      expect(content, `${file} 中不应出现真实实例域名`).not.toMatch(REAL_INSTANCE_DOMAIN_PATTERN);
    });
  }
});

describe('公开仓库产品边界 — 配置示例不含硬编码生产 Secret', () => {
  const envExample = readRepoFile('.env.example');

  it('GITEA_ADMIN_PASSWORD 标注为示例值且非强密码', () => {
    expect(envExample).toMatch(/GITEA_ADMIN_PASSWORD=change-this-admin-password/);
  });

  for (const { name, pattern } of SUSPICIOUS_SECRET_PATTERNS) {
    it(`.env.example 不含 ${name}`, () => {
      expect(envExample, name).not.toMatch(pattern);
    });
  }

  it('Cloudflare Tunnel 示例配置使用 REPLACE_WITH_TUNNEL_UUID 占位符', () => {
    const tunnelConf = readRepoFile('docker/cloudflared/config.yml.example');
    expect(tunnelConf).toContain('REPLACE_WITH_TUNNEL_UUID');
  });
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
