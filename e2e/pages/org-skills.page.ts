import { type Locator, type Page } from '@playwright/test';

export class OrgSkillsPage {
  private readonly page: Page;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.getByTestId('org-skills-table');
  }

  skillRow(skillName: string): Locator {
    return this.table.getByRole('row').filter({ hasText: skillName });
  }

  skillStateTag(skillName: string): Locator {
    return this.page.getByTestId(`skill-state-${skillName}`);
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/org/skills');
  }
}
