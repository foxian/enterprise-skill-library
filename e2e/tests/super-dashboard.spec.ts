import { test, expect } from '../fixtures/auth';
import { SuperDashboardPage } from '../pages/super-dashboard.page';

test.describe('平台概览', () => {
  test('统计卡与 Bootstrap 状态正常展示', async ({ superAdminPage }) => {
    const dashboard = new SuperDashboardPage(superAdminPage);
    await dashboard.goto();
    await expect(dashboard.statOrgs).toBeVisible();
    await expect(dashboard.statPending).toBeVisible();
    await expect(dashboard.statSkills).toBeVisible();
    // 健康栈下状态接口异步加载;就绪与否取决于环境 bootstrap 数据(repoOwner 等),
    // 断言状态卡渲染出了真实状态,而非依赖特定环境的 bootstrap 结果
    await expect(dashboard.bootstrapReady).toHaveText(/Bootstrap (未)?就绪/, { timeout: 15_000 });
  });
});
