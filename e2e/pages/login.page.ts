import { type Locator, type Page } from '@playwright/test';

export interface LoginCredentials {
  username: string;
  password: string;
  /** 组织账号在多组织模式下需要显式填组织;单组织模式留空由服务端按默认组织解析 */
  org?: string;
}

export class LoginPage {
  private readonly page: Page;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    this.page = page;
    this.errorAlert = page.getByTestId('login-error');
  }

  async goto(): Promise<void> {
    // 组织输入框的去留由 /api/public/platform-info 决定(初始渲染可见,单组织
    // 模式在返回后隐藏),等该请求返回再交互,避免把组织名误发给单组织登录。
    const platformInfo = this.page.waitForResponse((response) =>
      response.url().includes('/api/public/platform-info')
    );
    await this.page.goto('/admin/login');
    await platformInfo;
  }

  async login(credentials: LoginCredentials): Promise<void> {
    await this.page.getByTestId('username').fill(credentials.username);
    const orgInput = this.page.getByTestId('org');
    if (credentials.org && (await orgInput.isVisible())) {
      await orgInput.fill(credentials.org);
    }
    await this.page.getByTestId('password').fill(credentials.password);
    await this.page.getByTestId('login-submit').click();
  }
}
