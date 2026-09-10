import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Gitea(SQLite)在开发栈里扛不住多 worker 并发登录写 token(锁竞争会放大成
  // 挂起/空列表),本地限 2 个 worker;CI 可按栈能力调高。
  workers: isCI ? '50%' : 2,
  reporter: isCI ? [['blob'], ['github']] : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    baseURL,
    // 仓库选择器约定是 data-test(qa-project-context.md),getByTestId 按它匹配
    testIdAttribute: 'data-test',
    // 本机优先复用系统 Chrome,避免重复下载浏览器;CI 可用
    // E2E_BROWSER_CHANNEL 切回 playwright 自带内核(如 chromium)。
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 30_000,
    // 刻意不设全局 actionTimeout:自动等待的操作不应被全局超时掩盖真实慢因,
    // 个别已知慢的操作按需在调用点单独指定超时。
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup']
    }
  ],
  // E2E 目标是 docker compose 集成栈(nginx + api + gitea),栈已起时直接复用;
  // 前端代码变更需先 `npm run deploy:web` 重建 dist(nginx 挂载 packages/web/dist)。
  webServer: {
    command: 'docker compose up -d server',
    url: `${baseURL}/health`,
    reuseExistingServer: true,
    timeout: 180_000
  }
});
