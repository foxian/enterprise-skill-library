import { type Locator, type Page } from '@playwright/test';

export class SuperDashboardPage {
  readonly statOrgs: Locator;
  readonly statPending: Locator;
  readonly statSkills: Locator;
  readonly bootstrapReady: Locator;

  constructor(private readonly page: Page) {
    this.statOrgs = page.getByTestId('stat-orgs');
    this.statPending = page.getByTestId('stat-pending');
    this.statSkills = page.getByTestId('stat-skills');
    this.bootstrapReady = page.getByTestId('bootstrap-ready');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/super/dashboard');
  }
}
