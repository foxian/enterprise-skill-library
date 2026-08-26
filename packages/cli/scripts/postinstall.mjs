import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const syncModuleUrl = pathToFileURL(path.join(cliDir, 'dist', 'commands', 'sync-builtin.js'));

try {
  const { syncGlobalBuiltinSkill } = await import(syncModuleUrl.href);
  await syncGlobalBuiltinSkill({});
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`esl: built-in skill global sync deferred: ${message}`);
}