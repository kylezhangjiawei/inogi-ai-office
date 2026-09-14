// Uses a disposable, socket-only PostgreSQL instance; never uses the application's database.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  pgBin = process.env.AUDIT_RECEIPTS_TEST_PG_BIN || (await run('pg_config', ['--bindir'])).stdout.trim();
  temporaryRoot = await mkdtemp('/private/tmp/inogi-audit-receipts-db-');
  const dataRoot = join(temporaryRoot, 'data');
  await run(join(pgBin, 'initdb'), ['-D', dataRoot, '--username=inogi_audit_receipts_test', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8']);
  initialized = true;
  await run(join(pgBin, 'pg_ctl'), ['-D', dataRoot, '-l', join(temporaryRoot, 'postgres.log'), '-o', `-k ${temporaryRoot} -h '' -p 55441`, '-w', '-t', '15', 'start']);
  await run(join(pgBin, 'createdb'), ['-h', temporaryRoot, '-p', '55441', '-U', 'inogi_audit_receipts_test', 'inogi_audit_receipts_test']);
  const databaseUrl = new URL('postgresql://inogi_audit_receipts_test@localhost:55441/inogi_audit_receipts_test');
  databaseUrl.searchParams.set('host', temporaryRoot);
  const env = { ...process.env, DATABASE_URL: databaseUrl.toString(), AUDIT_RECEIPTS_TEST_DATABASE_URL: databaseUrl.toString(), TS_NODE_TRANSPILE_ONLY: '1' };

  // Derive empty source table definitions from the current schema, with no business rows.
  // The receipt suite separately applies its actual incremental migration in a random schema.
  const schema = await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { cwd: apiRoot, env, maxBuffer: 8 * 1024 * 1024 });
  const schemaFile = join(temporaryRoot, 'schema.sql');
  await writeFile(schemaFile, schema.stdout);
  await run(join(pgBin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', temporaryRoot, '-p', '55441', '-U', 'inogi_audit_receipts_test', '-d', 'inogi_audit_receipts_test', '-f', schemaFile], { maxBuffer: 4 * 1024 * 1024 });
  console.log('Running audit parity and receipt checks against disposable PostgreSQL.');
  const result = await run(process.execPath, ['--test', '--test-concurrency=1', '-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'test/audit-where-parity.spec.ts', 'test/purchase-receipts.postgres.spec.ts'], { cwd: apiRoot, env, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(`Isolated audit/receipt checks failed: ${error.message}`);
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
