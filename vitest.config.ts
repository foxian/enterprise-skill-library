import { defineConfig, defaultExclude } from 'vitest/config';

export default defineConfig({
  test: {
    // packages/web 使用自己的 vitest.config.ts（jsdom + Vue 插件），由 `npm test --workspace @esl/web` 运行
    // e2e/ 是 Playwright 套件（*.spec.ts 由 playwright test 运行），不归 vitest 收集
    // data/ 是本地运行态（docker compose 产出的 SQLite 与 Gitea 数据，见 .gitignore），
    // 永远不含测试源码；不排除它会让 `npm test` 在跑过 docker 的机器上因权限而崩溃。
    // .claude/worktrees/ 是 agent 工作树（.claude/ 已被 gitignore），它们共享主仓库的
    // node_modules 与 packages/*/dist，收集进来会用旧源码跑测试并产生假失败。
    exclude: [
      ...defaultExclude,
      '.worktrees/**',
      '.claude/worktrees/**',
      'packages/web/**',
      'e2e/**',
      'data/**'
    ],
    // 默认的 threads pool 在本仓库收尾时会 SIGSEGV：测试文件全部通过，但打印汇总前
    // 进程崩掉（exit 139），native 的 better-sqlite3 在 worker_threads 下退出不稳。
    // forks pool 用子进程，跑同样 90 个文件/891 用例全绿且干净退出。
    pool: 'forks'
  }
});
