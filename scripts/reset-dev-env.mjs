#!/usr/bin/env node
// Reset the ESL local development environment to a clean state.
//
// Tear down the Docker runtime, delete the three persistent data volumes
// (API DB, Gitea data, bootstrap secrets), and bring the stack back up from
// scratch. The existing first-run initialisation path does the heavy lifting:
// the API recreates its SQLite schema on startup and the gitea-bootstrap
// one-shot container regenerates the administrator and internal token.
// By default the reset finishes by seeding sample skill metadata
// (@myorg/my-skill); pass --no-seed to skip that.
//
// This is a destructive, host-level operation: it never runs inside the
// server or the CLI, and it must not be wired into any automatic trigger.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_DATA_DIR = join(repoRoot, 'data');

// Data subdirectories under ESL_DATA_DIR, each with the markers that prove it
// is ESL data. Deleting a directory that does not match is refused even with
// --yes, so a misconfigured --data-dir cannot destroy unrelated files.
// The gitea volume is Gitea's /data layout: git/, gitea/ and ssh/ subdirectories
// (repositories live under gitea/repositories, config under gitea/conf).
const DATA_SUBDIRS = {
  api: { markers: ['esl.db', 'packages'], hint: 'API 数据库与技能包' },
  gitea: { markers: ['git', 'gitea'], hint: 'Gitea 数据' },
  secrets: { markers: ['gitea-admin-token'], hint: 'Bootstrap 机密' }
};

const HEALTH_URL = 'http://localhost:3000/health';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_MS = 2_000;

function parseArgs(argv) {
  const opts = { yes: false, seed: true, dataDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes') {
      opts.yes = true;
    } else if (arg === '--no-seed') {
      opts.seed = false;
    } else if (arg === '--data-dir') {
      if (i + 1 >= argv.length) {
        throw new Error('--data-dir requires a path value');
      }
      opts.dataDir = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printUsage() {
  console.log(`Usage: node scripts/reset-dev-env.mjs [options]

Reset the ESL local Docker environment to a clean state: stop the stack,
delete the persistent data volumes (API DB, Gitea data, bootstrap secrets),
recreate them via the first-run initialisation path, and re-seed sample data.

Options:
  --yes          skip the interactive confirmation (content checks still apply)
  --no-seed      do not re-seed sample skill metadata after reset
  --data-dir <d> override the persistent data directory (default: ESL_DATA_DIR
                 env or ${DEFAULT_DATA_DIR})
  --help, -h     show this help

Environment:
  ESL_DATA_DIR   persistent data root, same variable used by docker-compose.yml`);
}

function collectTargets(dataDir) {
  const targets = [];
  const refusals = [];
  for (const [name, spec] of Object.entries(DATA_SUBDIRS)) {
    const dir = join(dataDir, name);
    if (!existsSync(dir)) {
      // Missing is fine: nothing to clean. Only present-but-unrecognised
      // directories are dangerous.
      continue;
    }
    const entries = readdirSync(dir);
    const hasMarker = spec.markers.some((marker) => entries.includes(marker));
    if (!hasMarker) {
      refusals.push(
        `${dir} does not look like ESL ${spec.hint} (expected one of: ${spec.markers.join(', ')}); refusing to delete`
      );
      continue;
    }
    targets.push(dir);
  }
  return { targets, refusals };
}

async function confirmDeletion(targets) {
  console.log('This will delete the following ESL local data directories:');
  for (const dir of targets) {
    console.log(`  - ${dir}`);
  }
  console.log('The Docker runtime will be stopped and recreated from scratch.');
  console.log('This is destructive and cannot be undone.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type yes to continue: ');
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

function runDocker(args) {
  const result = spawnSync('docker', args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  return result.status;
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) {
        return true;
      }
    } catch {
      // API not up yet; poll again.
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, HEALTH_POLL_MS));
  }
  return false;
}

export async function resetDevEnvironment(options = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.ESL_DATA_DIR ?? DEFAULT_DATA_DIR);
  const { targets, refusals } = collectTargets(dataDir);

  if (refusals.length > 0) {
    for (const refusal of refusals) {
      console.error(`Refusing to reset: ${refusal}`);
    }
    console.error('Fix the --data-dir / ESL_DATA_DIR setting and try again.');
    return { ok: false };
  }

  if (targets.length === 0) {
    console.log('No ESL data volumes found under ' + dataDir + ' — nothing to clean.');
  } else if (!options.yes && !(await confirmDeletion(targets))) {
    console.log('Reset cancelled.');
    return { ok: false, cancelled: true };
  }

  console.log('Stopping the Docker stack...');
  const downStatus = runDocker(['compose', 'down']);
  if (downStatus !== 0) {
    console.error('docker compose down failed (status ' + downStatus + ').');
    return { ok: false };
  }

  for (const dir of targets) {
    // Surface what is actually being removed: files not tracked by git
    // (e.g. the E2E helper data/esl-db-tool.cjs) are destroyed too.
    const entries = readdirSync(dir);
    console.log(`Deleting ${dir} (contains: ${entries.join(', ') || '(empty)'})...`);
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('Recreating the Docker stack (first-run initialisation runs automatically)...');
  const upStatus = runDocker(['compose', 'up', '-d']);
  if (upStatus !== 0) {
    console.error('docker compose up failed (status ' + upStatus + ').');
    return { ok: false };
  }

  console.log(`Waiting for API health at ${HEALTH_URL}...`);
  if (!(await waitForHealth(HEALTH_TIMEOUT_MS))) {
    console.error('API did not become healthy in time; the stack may still be starting.');
    console.error('Once it is up, seed manually with: docker compose exec api npm run seed --workspace @esl/server');
    return { ok: false };
  }

  if (options.seed !== false) {
    console.log('Seeding sample skill metadata (@myorg/my-skill)...');
    const seedStatus = runDocker([
      'compose', 'exec', '-T', 'api',
      'npm', 'run', 'seed', '--workspace', '@esl/server'
    ]);
    if (seedStatus !== 0) {
      console.error('Seeding failed (status ' + seedStatus + '); reset itself succeeded.');
      console.error('Retry with: docker compose exec api npm run seed --workspace @esl/server');
    }
  }

  console.log('');
  console.log('ESL local environment reset complete.');
  console.log('Note: any prior esl CLI login state (~/.skill-library/) is invalidated; re-run `esl login`.');
  return { ok: true };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    printUsage();
    return;
  }
  const result = await resetDevEnvironment({ yes: opts.yes, seed: opts.seed, dataDir: opts.dataDir });
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function isDirectRun(moduleUrl, argvPath) {
  if (!argvPath) {
    return false;
  }
  return normalizePath(fileURLToPath(moduleUrl)) === normalizePath(argvPath);
}

function normalizePath(path) {
  return path.replace(/\\/g, '/').replace(/^\/([A-Za-z]:\/)/, '$1');
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
