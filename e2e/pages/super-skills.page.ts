import { type Locator, type Page } from '@playwright/test';

export class SuperSkillsPage {
  private readonly page: Page;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.getByTestId('super-skills-table');
  }

  skillRow(skillName: string): Locator {
    return this.table.getByRole('row').filter({ hasText: skillName });
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/super/skills');
  }
}
