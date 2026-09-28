import { normalizeSkillUserEmail } from '@esl/core';
import type { EmailActionRepository, UserRegistrationRepository } from '../db/database.js';
import type { GiteaService } from './gitea.js';

export type SkillUserEmailConflict = 'pending-registration' | 'active-user';

export async function findSkillUserEmailConflict(
  giteaService: GiteaService,
  userRegistrationRepository: UserRegistrationRepository,
  rawEmail: string,
  options: { exceptUsername?: string; emailActionRepository?: EmailActionRepository } = {}
): Promise<SkillUserEmailConflict | null> {
  const email = normalizeSkillUserEmail(rawEmail);
  const pending = userRegistrationRepository.getPendingByEmail(email);
  if (pending && pending.username !== options.exceptUsername) {
    return 'pending-registration';
  }
  const pendingEmailAction = options.emailActionRepository?.getPendingByEmail(email);
  if (pendingEmailAction && pendingEmailAction.username !== options.exceptUsername) {
    return 'pending-registration';
  }
  const users = await giteaService.listUsers();
  return users.some(
    (user) => user.username !== options.exceptUsername && normalizeSkillUserEmail(user.email) === email
  )
    ? 'active-user'
    : null;
}
