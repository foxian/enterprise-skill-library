import { defineConfig, defaultExclude } from 'vitest/config';

export default defineConfig({
  test: {
    // packages/web 使用自己的 vitest.config.ts（jsdom + Vue 插件），由 `npm test --workspace @esl/web` 运行
    // e2e/ 是 Playwright 套件（*.spec.ts 由 playwright test 运行），不归 vitest 收集
    exclude: [...defaultExclude, '.worktrees/**', 'packages/web/**', 'e2e/**']
  }
});
