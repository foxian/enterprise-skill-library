import { type Locator, type Page } from '@playwright/test';

export class MembersPage {
  private readonly page: Page;
  readonly table: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.getByTestId('members-table');
    this.rows = this.table.getByRole('row');
  }

  /** 表格展示的是去组织前缀的短用户名 */
  memberRow(shortUsername: string): Locator {
    return this.rows.filter({ hasText: shortUsername });
  }

  /** 行内按钮的 data-test 用完整 Gitea 用户名(<org>_<username>) */
  resetPasswordButton(fullUsername: string): Locator {
    return this.page.getByTestId(`reset-password-${fullUsername}`);
  }

  disableButton(fullUsername: string): Locator {
    return this.page.getByTestId(`disable-${fullUsername}`);
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/org/members');
  }

  async addMember(shortUsername: string, initialPassword: string): Promise<void> {
    await this.page.getByTestId('open-add-member').click();
    await this.page.getByTestId('add-member-username').fill(shortUsername);
    await this.page.getByTestId('add-member-password').fill(initialPassword);
    await this.page.getByTestId('add-member-submit').click();
  }
}
