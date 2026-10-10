// Use a disposable socket-only database; never read or migrate the application's database.
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
  pgBin = process.env.RD_MEETING_TEST_PG_BIN || (await run('pg_config', ['--bindir'])).stdout.trim();
  temporaryRoot = await mkdtemp('/private/tmp/rd-meeting-db-');
  const dataRoot = join(temporaryRoot, 'data');
  await run(join(pgBin, 'initdb'), ['-D', dataRoot, '--username=rd_meeting_test', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8']);
  initialized = true;
  await run(join(pgBin, 'pg_ctl'), ['-D', dataRoot, '-l', join(temporaryRoot, 'postgres.log'), '-o', `-k ${temporaryRoot} -h '' -p 55442`, '-w', '-t', '15', 'start']);
  await run(join(pgBin, 'createdb'), ['-h', temporaryRoot, '-p', '55442', '-U', 'rd_meeting_test', 'rd_meeting_test']);
  const databaseUrl = new URL('postgresql://rd_meeting_test@localhost:55442/rd_meeting_test');
  databaseUrl.searchParams.set('host', temporaryRoot);
  const result = await run(process.execPath, ['--test', '-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'test/rd-meeting-todos.spec.ts'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl.toString(), RD_MEETING_TEST_DATABASE_URL: databaseUrl.toString(), TS_NODE_TRANSPILE_ONLY: '1' },
    maxBuffer: 4 * 1024 * 1024,
  });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(`Isolated meeting todo checks failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (initialized) {
    try { await run(join(pgBin, 'pg_ctl'), ['-D', join(temporaryRoot, 'data'), '-m', 'immediate', '-w', '-t', '15', 'stop']); stopped = true; }
    catch {
      try { await run(join(pgBin, 'pg_ctl'), ['-D', join(temporaryRoot, 'data'), 'status']); }
      catch (error) { stopped = error.code === 3; }
      if (!stopped) { console.error(`Test database stop not confirmed; retained ${temporaryRoot}.`); process.exitCode = 1; }
    }
  }
  if (temporaryRoot && (!initialized || stopped)) await rm(temporaryRoot, { recursive: true, force: true });
}
