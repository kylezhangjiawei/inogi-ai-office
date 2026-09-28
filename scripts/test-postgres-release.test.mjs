import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./test-postgres-release.sh', import.meta.url));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
await access(bash);
const shellPath = (path) => path.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll('\\', '/');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const runners = ['applicant-forms', 'audit-receipts', 'chat-workspace', 'procurement-rollback', 'rd-documents']
  .map((name) => `test-${name}-postgres.mjs`);

async function runGate({ uid = 0, directory = 'safe', failure = '', missingTool = false, missingPgConfig = false, permission = false, skipped = 0, missingSummary = false, signal = '', signalGroup = false } = {}) {
  const base = fileURLToPath(new URL('../.tmp/deploy-tests/', import.meta.url));
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'inogi-postgres-gate-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const events = join(root, 'events');
  await Promise.all([mkdir(bin), mkdir(home)]);
  const eventPath = quote(shellPath(events));
  const put = async (name, body) => {
    const path = join(bin, name);
    await writeFile(path, `#!/usr/bin/env bash\n${body}\n`);
    await chmod(path, 0o755);
  };
  await put('node', `
if [ "\${1:-}" = -e ]; then exit ${permission ? 9 : 0}; fi
if [ -n "\${DATABASE_URL+x}\${OSS_ACCESS_KEY_SECRET+x}\${BASH_ENV+x}" ] || [ "\${NODE_OPTIONS:-}" != --test-reporter=tap ]; then exit 98; fi
for key in APPLICANT_FORMS_TEST_PG_BIN AUDIT_RECEIPTS_TEST_PG_BIN CHAT_TEST_PG_BIN PROC_ROLLBACK_TEST_PG_BIN RD_DOCUMENTS_TEST_PG_BIN; do
  [ "\${!key}" = ${quote(shellPath(bin))} ] || exit 96
done
printf 'runner:%s\\n' "\${1##*/}" >> ${eventPath}
${signal ? `touch ${quote(shellPath(join(root, 'ready')))}
for ((i=0; i<200; i++)); do
  [ -f ${quote(shellPath(join(root, 'signalled')))} ] && break
  sleep 0.02
done
test -d "$HOME" || exit 97
printf 'runner-cleaned\\n' >> ${eventPath}` : ''}
if [ "\${1##*/}" = ${quote(failure)} ]; then exit 23; fi
echo '# pass 1'
echo '# fail 0'
${missingSummary ? ':' : `echo '# skipped ${skipped}'`}`);
  await put('pg_config', `printf '%s\\n' ${quote(shellPath(bin))}`);
  await put('runuser', `printf 'identity:%s\\n' "$*" >> ${eventPath}\nshift 3\nexec "$@"`);
  for (const name of ['initdb', 'pg_ctl', 'createdb', 'psql']) await put(name, 'exit 0');
  const signalHelper = `
for ((i=0; i<200; i++)); do
  if [ -f ${quote(shellPath(join(root, 'ready')))} ]; then
    kill -s ${signal || 'TERM'} -- ${signalGroup ? '-"$1"' : '"$1"'}
    touch ${quote(shellPath(join(root, 'signalled')))}
    exit
  fi
  sleep 0.02
done`;
  const harness = `
export PATH=${quote(shellPath(bin))}:/usr/bin:/bin
uname() { echo Linux; }
command() {
  if [ "\${1:-}" = -v ] && [ "\${2:-}" = pg_config ] && [ ${missingPgConfig ? 1 : 0} = 1 ]; then return 1; fi
  builtin command "$@"
}
id() { if [ "\${2:-}" = nobody ]; then echo 65534; else echo ${uid}; fi; }
stat() {
  if [ "\${*: -1}" = /private ]; then echo 0:755;
  else echo ${directory === 'owner' ? '1001:1777' : directory === 'mode' ? '0:777' : '0:1777'}; fi
}
test() {
  if [ "\${1:-}" = '!' ]; then shift; if test "$@"; then return 1; else return 0; fi; fi
  if [ "\${2:-}" = /private ] || [ "\${2:-}" = /private/tmp ]; then
    case "$1" in
      -L) [ ${quote(directory)} = symlink ] && [ "$2" = /private/tmp ]; return ;;
      -e|-d) [ ${quote(directory)} != missing ] || [ "\${created:-}" = yes ]; return ;;
    esac
  fi
  if [ "$1" = -x ] && [[ "\${2:-}" == */psql ]] && [ ${missingTool ? 1 : 0} = 1 ]; then return 1; fi
  builtin test "$@"
}
mkdir() {
  case "\${*: -1}" in
    /private|/private/tmp) printf 'mkdir:%s\\n' "$*" >> ${eventPath}; created=yes ;;
    *) command mkdir -- "\${*: -1}" ;;
  esac
}
mktemp() { printf '%s\\n' ${quote(shellPath(home))}; }
chown() { printf 'chown:%s\\n' "$*" >> ${eventPath}; }
chmod() { printf 'chmod:%s\\n' "$*" >> ${eventPath}; }
${process.platform === 'win32' ? 'setsid() { shift; "$@"; }' : ''}
${signal ? `setsid --wait bash -c ${quote(signalHelper)} gate-signal "$$" &` : ''}
source "$1"
`;
  try {
    const shellArgs = ['-c', harness, 'postgres-gate-test', shellPath(script)];
    // The whole-group test owns its session, so its signal cannot reach the test
    // runner, developer terminal, or unrelated processes. The sender is separate.
    const result = spawnSync(signalGroup ? '/usr/bin/setsid' : bash, signalGroup ? ['--wait', bash, ...shellArgs] : shellArgs, {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: 'must-not-inherit', OSS_ACCESS_KEY_SECRET: 'must-not-inherit', NODE_OPTIONS: '--trace-warnings' },
      encoding: 'utf8', timeout: 15_000,
    });
    const recorded = await readFile(events, 'utf8').catch(() => '');
    const homeRemoved = await access(home).then(() => false, () => true);
    return { ...result, events: recorded, homeRemoved, output: result.stdout + result.stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const uid of [0, 1000]) {
  test(`release PostgreSQL gate runs five existing runners with clean credentials as non-root (caller ${uid})`, async () => {
    const result = await runGate({ uid });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.events.split('\n').filter((line) => line.startsWith('runner:')), runners.map((name) => `runner:${name}`));
    assert.equal(result.events.includes('identity:-u nobody --'), uid === 0);
    assert.doesNotMatch(result.events, /mkdir:|must-not-inherit/);
    assert.equal(result.homeRemoved, true);
  });
}

test('release PostgreSQL gate reuses installed PostgreSQL binaries when pg_config is absent', async () => {
  const result = await runGate({ missingPgConfig: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.events.split('\n').filter((line) => line.startsWith('runner:')).length, 5);
});

test('release PostgreSQL gate stops after a runner fails', async () => {
  const result = await runGate({ failure: runners[1] });
  assert.notEqual(result.status, 0, result.output);
  assert.deepEqual(result.events.split('\n').filter((line) => line.startsWith('runner:')), runners.slice(0, 2).map((name) => `runner:${name}`));
  assert.equal(result.homeRemoved, true);
});

for (const [signal, status] of [['TERM', 143], ['INT', 130]]) {
  test(`release PostgreSQL gate waits for active runner cleanup after SIG${signal}`, async () => {
    const result = await runGate({ signal });
    assert.equal(result.error, undefined);
    assert.equal(result.status, status, result.output);
    assert.deepEqual(result.events.split('\n').filter((line) => line.startsWith('runner:')), [`runner:${runners[0]}`]);
    assert.match(result.events, /runner-cleaned/);
    assert.equal(result.homeRemoved, true);
  });
  test(`release PostgreSQL gate preserves runner cleanup after whole-group SIG${signal}`, {
    skip: process.platform !== 'linux' ? 'Requires Linux sessions and real setsid; PID-only signals are covered above.' : false,
  }, async () => {
    const result = await runGate({ signal, signalGroup: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, status, result.output);
    assert.deepEqual(result.events.split('\n').filter((line) => line.startsWith('runner:')), [`runner:${runners[0]}`]);
    assert.match(result.events, /runner-cleaned/);
    assert.equal(result.homeRemoved, true);
  });
}

for (const options of [{ skipped: 1 }, { missingSummary: true }]) {
  test(`release PostgreSQL gate rejects a zero-exit runner without zero-skip evidence ${JSON.stringify(options)}`, async () => {
    const result = await runGate(options);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /zero failures\/skips/);
    assert.equal(result.events.split('\n').filter((line) => line.startsWith('runner:')).length, 1);
  });
}

for (const directory of ['symlink', 'owner', 'mode']) {
  test(`release PostgreSQL gate rejects an unsafe temporary directory (${directory}) without changing it`, async () => {
    const result = await runGate({ directory });
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.events, /runner:|mkdir:|chown:|chmod:/);
  });
}

test('release PostgreSQL gate creates missing compatibility directories only for root', async () => {
  const root = await runGate({ directory: 'missing' });
  assert.equal(root.status, 0, root.output);
  assert.match(root.events, /mkdir:.*\/private/);
  const ordinary = await runGate({ directory: 'missing', uid: 1000 });
  assert.notEqual(ordinary.status, 0);
  assert.doesNotMatch(ordinary.events, /runner:|mkdir:/);
});

for (const options of [{ missingTool: true }, { permission: true }]) {
  test(`release PostgreSQL gate rejects missing prerequisites ${JSON.stringify(options)}`, async () => {
    const result = await runGate(options);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.events, /runner:/);
  });
}
