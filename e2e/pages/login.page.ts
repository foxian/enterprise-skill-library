import { type Locator, type Page } from '@playwright/test';

export interface LoginCredentials {
  username: string;
  password: string;
}

// 全局身份登录（ADR-0032）：登录页只有用户名与密码，不再选择组织。
export class LoginPage {
  private readonly page: Page;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    this.page = page;
    this.errorAlert = page.getByTestId('login-error');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/login');
  }

  async login(credentials: LoginCredentials): Promise<void> {
    await this.page.getByTestId('username').fill(credentials.username);
    await this.page.getByTestId('password').fill(credentials.password);
    await this.page.getByTestId('login-submit').click();
  }
}
