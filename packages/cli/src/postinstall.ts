import { syncGlobalBuiltinSkill } from './commands/sync-builtin.js';

try {
  await syncGlobalBuiltinSkill({});
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`esl: built-in skill global sync deferred: ${message}`);
}
