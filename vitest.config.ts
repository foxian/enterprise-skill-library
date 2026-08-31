import { defineConfig, defaultExclude } from 'vitest/config';

export default defineConfig({
  test: {
    // packages/web 使用自己的 vitest.config.ts（jsdom + Vue 插件），由 `npm test --workspace @esl/web` 运行
    exclude: [...defaultExclude, '.worktrees/**', 'packages/web/**']
  }
});
