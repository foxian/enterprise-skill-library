import { type Locator, type Page } from '@playwright/test';

export class MemberSkillsPage {
  private readonly page: Page;
  readonly managedTable: Locator;
  readonly sharedTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.managedTable = page.getByTestId('member-skills-table');
    this.sharedTable = page.getByTestId('member-shared-table');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/member/skills');
  }

  managedRow(skillName: string): Locator {
    return this.managedTable.getByRole('row').filter({ hasText: skillName });
  }

  sharedRow(skillName: string): Locator {
    return this.sharedTable.getByRole('row').filter({ hasText: skillName });
  }

  async openSharedTab(): Promise<void> {
    await this.page.getByRole('tab', { name: '共享给我的' }).click();
  }

  async openPermissions(skillName: string): Promise<void> {
    await this.page.getByTestId(`configure-${skillName}`).click();
  }
}
