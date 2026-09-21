import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 生产冒烟检查（scripts/prod/smoke.sh，curl 版）须与 node 版
// （scripts/check-git-backend-maintenance-entry.mjs）端点语义对齐
// （Issue #71 接缝 1）：服务器上无 node，deploy.sh 调用本脚本做部署后验证。
const smoke = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/prod/smoke.sh'),
  'utf8'
);

describe('生产冒烟脚本与 node 版语义对齐', () => {
  it('基于 curl 实现（服务器只装 bash + docker）', () => {
    expect(smoke).toContain('curl');
  });

  it('覆盖 /health（API 就绪）', () => {
    expect(smoke).toContain('/health');
  });

  it('覆盖 /api/auth/login（API 边界：仅要求非 5xx）', () => {
    expect(smoke).toContain('/api/auth/login');
    expect(smoke).toMatch(/5\d\d/);
  });

  it('覆盖 /git/user/login（Git Backend Maintenance Entry 页面）', () => {
    expect(smoke).toContain('/git/user/login');
  });

  it('断言登录页引用 CSS、JavaScript、图片三类静态资产（对齐 node 版资产发现）', () => {
    expect(smoke).toMatch(/\bcss\b/);
    expect(smoke).toMatch(/\bjs\b/);
    // 图片族扩展名集合对齐 node 版 (svg|png|jpg|jpeg|webp)
    for (const imageExt of ['svg', 'png', 'jpg', 'jpeg', 'webp']) {
      expect(smoke).toContain(imageExt);
    }
  });

  it('支持从参数或 ESL_SERVER_URL 取对外地址', () => {
    expect(smoke).toContain('ESL_SERVER_URL');
  });
});
