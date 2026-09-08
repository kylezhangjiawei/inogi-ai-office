#!/usr/bin/env node
// A disposable PostgreSQL server, reachable only through its own temporary Unix socket.
// This command never reads .env or connects to the application's DATABASE_URL.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let temporaryRoot;
let initialized = false;
let stopped = false;
let pgBin;
try {
  pgBin = process.env.CHAT_TEST_PG_BIN || (await run('pg_config', ['--bindir'])).stdout.trim();
  // The prefix also satisfies the existing archive integration test's isolation guard.
  temporaryRoot = await mkdtemp('/private/tmp/matechat-archive-db-');
  const dataRoot = join(temporaryRoot, 'data');
  await run(join(pgBin, 'initdb'), ['-D', dataRoot, '--username=matechat_test', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8']);
  initialized = true;
  await run(join(pgBin, 'pg_ctl'), ['-D', dataRoot, '-l', join(temporaryRoot, 'postgres.log'), '-o', `-k ${temporaryRoot} -h '' -p 55439`, '-w', '-t', '15', 'start']);
  await run(join(pgBin, 'createdb'), ['-h', temporaryRoot, '-p', '55439', '-U', 'matechat_test', 'matechat_test']);
  const databaseUrl = new URL('postgresql://matechat_test@localhost:55439/matechat_test');
  databaseUrl.searchParams.set('host', temporaryRoot);
  const env = { ...process.env, DATABASE_URL: databaseUrl.toString(), CHAT_WORKSPACE_TEST_DATABASE_URL: databaseUrl.toString(),
    CHAT_ARCHIVE_TEST_DATABASE_URL: databaseUrl.toString(), TS_NODE_TRANSPILE_ONLY: '1' };
  console.log('Running MateChat migration and persistence checks against a disposable, socket-only PostgreSQL database.');
  const result = await run(process.execPath, ['--test', '--test-concurrency=1', '-r', 'ts-node/register', '-r', 'tsconfig-paths/register',
    'test/chat-workspace.postgres.spec.ts', 'test/chat-archives.postgres.spec.ts'], { cwd: apiRoot, env, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(`Isolated PostgreSQL checks failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (initialized) {
    try {
      await run(join(pgBin, 'pg_ctl'), ['-D', join(temporaryRoot, 'data'), '-m', 'immediate', '-w', '-t', '15', 'stop']);
      stopped = true;
    } catch {
      // A failed start leaves no server to stop; never delete data under a live server.
      try { await run(join(pgBin, 'pg_ctl'), ['-D', join(temporaryRoot, 'data'), 'status']); }
      catch (error) { stopped = error.code === 3; }
      if (!stopped) {
        console.error(`Could not confirm the test server stopped; temporary files retained at ${temporaryRoot}.`);
        process.exitCode = 1;
      }
    }
  }
  if (temporaryRoot && (!initialized || stopped)) await rm(temporaryRoot, { recursive: true, force: true });
}
