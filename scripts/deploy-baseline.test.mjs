import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const deploySource = await readFile(new URL("./deploy.sh", import.meta.url), "utf8");
const deployPath = fileURLToPath(new URL("./deploy.sh", import.meta.url));
const plannerSource = await readFile(new URL("./deploy-change-plan.mjs", import.meta.url), "utf8");

const expectedStages = [
  "checkout",
  "dependency_install",
  "prisma_generate",
  "typecheck_frontend",
  "typecheck_api",
  "tests_scripts",
  "tests_deploy",
  "tests_api_contracts",
  "tests_api",
  "tests_postgres_applicant_forms",
  "tests_postgres_audit_receipts",
  "tests_postgres_chat_workspace",
  "tests_postgres_procurement_rollback",
  "tests_postgres_rd_documents",
  "frontend_build",
  "api_build",
  "database_backup",
  "database_migration",
  "api_restart",
  "api_readiness",
  "frontend_activate",
  "nginx_reload",
  "frontend_readiness",
];

function configuredStages() {
  const match = deploySource.match(/DEPLOY_STAGE_NAMES=\(\s*([\s\S]*?)\s*\)/);
  assert.ok(match, "deploy.sh should declare the baseline stage list");
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function availableBash() {
  const candidates = process.platform === "win32"
    ? ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"]
    : ["/bin/bash", "/usr/bin/bash"];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  return null;
}

function availableUtf8Locale(bash) {
  if (!bash) return null;
  for (const locale of ["C.UTF-8", "C.utf8", "en_US.UTF-8", "en_US.utf8"]) {
    const result = spawnSync(bash, ["-c", "locale charmap"], {
      env: { ...process.env, LC_ALL: locale, LANG: locale },
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.status === 0 && /^UTF-?8$/i.test(result.stdout.trim())) return locale;
  }
  return null;
}

function bashPath(path) {
  if (process.platform !== "win32") return path;
  return path
    .replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`)
    .replaceAll("\\", "/");
}

async function writeStub(binDir, name, body = "exit 0") {
  const path = join(binDir, name);
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`, "utf8");
  await chmod(path, 0o755);
}

async function createFakeDeployment() {
  // Both Node and Git Bash must be able to traverse the disposable fixture.
  // Windows sandbox permissions can differ for the user's system temp ancestors.
  const tempRoot = fileURLToPath(new URL('../.tmp/deploy-tests/', import.meta.url));
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "inogi-deploy-baseline-"));
  const repoDir = join(root, "repo");
  const binDir = join(root, "bin");
  const webRoot = join(root, "web");
  const metricsDir = join(root, "metrics");
  await Promise.all([
    mkdir(join(repoDir, "apps", "api"), { recursive: true }),
    mkdir(join(repoDir, "apps", "api", "scripts"), { recursive: true }),
    mkdir(join(repoDir, "apps", "api", "dist", "src"), { recursive: true }),
    mkdir(join(repoDir, "dist"), { recursive: true }),
    mkdir(join(repoDir, "node_modules", ".pnpm"), { recursive: true }),
    mkdir(join(repoDir, "scripts"), { recursive: true }),
    mkdir(binDir, { recursive: true }),
    mkdir(webRoot, { recursive: true }),
    mkdir(metricsDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(repoDir, "dist", "index.html"), "<main>build fixture</main>"),
    writeFile(join(repoDir, "apps", "api", "dist", "src", "main.js"), "// build fixture\n"),
    writeFile(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8"),
    writeFile(join(repoDir, "apps/api/scripts/run-tests.cjs"), "// Compiler subprocess fixture\nprocess.exit(0);\n"),
    writeFile(join(repoDir, "scripts", "test-postgres-release.sh"), "exit 0\n", "utf8"),
    writeFile(join(repoDir, "scripts", "deploy-frontend-readiness.mjs"), "// HTTP boundary is simulated by the node fixture.\n", "utf8"),
    ...["deploy-baseline", "deploy-change-plan", "test-postgres-release", "business"].map((name) =>
      writeFile(join(repoDir, "scripts", `${name}.test.mjs`), "export {};\n", "utf8")),
    writeStub(binDir, "pnpm"),
    writeStub(binDir, "flock", 'shift 6; exec "$@"'),
    writeStub(binDir, "npm"),
    writeStub(binDir, "npx"),
    writeStub(binDir, "pm2", `
if [ "\${1:-}" = "start" ] || [ "\${1:-}" = "restart" ]; then
  printf '{"ok":true,"database":"ready","git_sha":"%s","release":"%s"}\\n' "$APP_GIT_SHA" "$APP_VERSION" > "$REPO_DIR/.deploy-cache/app-health.json"
fi
exit 0`),
    writeStub(binDir, "curl", 'cat "$REPO_DIR/.deploy-cache/app-health.json"'),
    writeStub(binDir, "nginx"),
    writeStub(binDir, "node", `if [ "\${1:-}" = "--version" ]; then echo v22.22.1; exit 0; fi
if [ "\${1:-}" = "-e" ]; then exec "${bashPath(process.execPath)}" "$@"; fi
if [[ "\${1:-}" == *deploy-frontend-readiness.mjs ]]; then
  printf '%s\\n' "$2" "$3" > "$REPO_DIR/.deploy-cache/frontend-http-call"
  exit "\${DEPLOY_TEST_FRONTEND_STATUS:-0}"
fi
exit 0`),
  ]);
  return { root, repoDir, binDir, webRoot, metricsDir };
}

async function enableChangePlanner(fixture) {
  await Promise.all([
    mkdir(join(fixture.repoDir, "scripts"), { recursive: true }),
    mkdir(join(fixture.repoDir, "src"), { recursive: true }),
    mkdir(join(fixture.repoDir, "apps", "api", "src"), { recursive: true }),
    mkdir(join(fixture.repoDir, "apps", "api", "prisma", "migrations"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(fixture.repoDir, "scripts", "deploy-change-plan.mjs"), plannerSource, "utf8"),
    writeFile(join(fixture.repoDir, "scripts", "deploy.sh"), deploySource, "utf8"),
    writeFile(join(fixture.repoDir, "scripts", "deploy-artifacts.mjs"), await readFile(new URL("./deploy-artifacts.mjs", import.meta.url), "utf8")),
    writeFile(join(fixture.repoDir, "src", "App.tsx"), "export const App = 1;\n", "utf8"),
    writeFile(join(fixture.repoDir, "apps", "api", "src", "main.ts"), "export const api = 1;\n", "utf8"),
    writeFile(join(fixture.repoDir, "apps", "api", "prisma", "schema.prisma"), "generator client { provider = \"prisma-client-js\" }\n", "utf8"),
  ]);
  const realNode = bashPath(process.execPath).replaceAll('"', '\\"');
  await writeStub(fixture.binDir, "node", `
case "\${1:-}" in
  *deploy-frontend-readiness.mjs)
    printf '%s\\n' "$2" "$3" > "$REPO_DIR/.deploy-cache/frontend-http-call"
    exit "\${DEPLOY_TEST_FRONTEND_STATUS:-0}" ;;
  *deploy-change-plan.mjs|*deploy-artifacts.mjs|-e) exec "${realNode}" "$@" ;;
  --version) echo v22.22.1 ;;
esac
exit 0`);
}

function runFakeDeployment(bash, fixture, overrides = {}, prelude = "") {
  const stubPath = `${bashPath(fixture.binDir)}:/usr/local/bin:/usr/bin:/bin`;
  const env = {
    ...process.env,
    PATH: stubPath,
    DEPLOY_TEST_PATH: stubPath,
    REPO_DIR: bashPath(fixture.repoDir),
    DEPLOY_LOCK_HELD: bashPath(fixture.repoDir),
    WEB_ROOT: bashPath(fixture.webRoot),
    DEPLOY_METRICS_DIR: bashPath(fixture.metricsDir),
    DEPLOY_SKIP_GIT: "1",
    DEPLOY_GIT_SHA: "0123456789abcdef0123456789abcdef01234567",
    DEPLOY_DB_BACKUP: "0",
    DEPLOY_CHANGE_PLAN: "0",
    DEPLOY_PREPARE_ONLY: "0",
    DEPLOY_ARTIFACT_DIR: "",
    DEPLOY_RUN_TESTS: "1",
    DEPLOY_HEALTH_TIMEOUT_SECONDS: "2",
    DEPLOY_FRONTEND_URL: "https://public.example.invalid/",
    DEPLOY_TEST_FRONTEND_STATUS: "0",
    DEPLOY_OPERATOR: 'qa"\n\u0001operator',
    DATABASE_URL: "postgresql://secret-user:secret-password@secret-host/secret-db",
    ...overrides,
  };
  // Git Bash 启动时会把自带 curl 等目录插到 PATH 最前，须在启动后恢复桩优先级。
  // source 在同一 shell 执行，避免再次启动 Bash 重排 PATH 并误调用真实基础设施。
  return spawnSync(bash, ["-c", `export PATH="$DEPLOY_TEST_PATH"\n${prelude}\nsource "$1"`, "deploy-test", bashPath(deployPath)], {
    cwd: fixture.repoDir,
    env,
    encoding: "utf8",
    // Git Bash process startup is slower under the parallel Windows suite.
    // This bounds the harness, not DEPLOY_HEALTH_TIMEOUT_SECONDS (still 1–2s).
    timeout: process.platform === "win32" ? 90_000 : 30_000,
  });
}

const bash = await availableBash();
const utf8Locale = availableUtf8Locale(bash);

const resourceHelpers = deploySource.slice(deploySource.indexOf("init_deploy_resources()"), deploySource.indexOf("json_escape()"));
for (const [allowed, expected, probeFails] of [["4-7", "4,5"], ["3,8", "3"], ["9", "9"], ["2-3,8-9", "2,3"], ["4-7", null, true], [null, null, true]]) {
  test(`resource budget uses allowed CPUs ${allowed}${probeFails ? " with safe fallback" : ""}`, { skip: !bash }, async () => {
    const fixture = await createFakeDeployment();
    try {
      await writeStub(fixture.binDir, "uname", "echo Linux");
      await writeStub(fixture.binDir, "taskset", `
if [ "$1" = -pc ]; then echo 'pid affinity list: ${allowed}'; exit ${allowed ? 0 : 1}; fi
if [ "$3" = true ]; then exit ${probeFails ? 1 : 0}; fi
printf 'affinity:%s\\n' "$2" >> "$RESOURCE_LOG"
shift 2
exec "$@"`);
      await writeStub(fixture.binDir, "nice", 'shift 2; exec "$@"');
      await writeStub(fixture.binDir, "work", 'echo work >> "$RESOURCE_LOG"; exit 37');
      const logPath = join(fixture.root, "resources.log");
      const result = spawnSync(bash, ["-s"], {
        input: `set -Eeuo pipefail\nexport PATH="$STUB_PATH"\nlog() { echo "$*"; }\n${resourceHelpers}\ninit_deploy_resources\nlimited_run work\n`,
        env: { ...process.env, STUB_PATH: `${bashPath(fixture.binDir)}:/usr/bin:/bin`, RESOURCE_LOG: bashPath(logPath) },
        encoding: "utf8", timeout: 10_000,
      });
      assert.equal(result.status, 37, result.stdout + result.stderr);
      const calls = (await readFile(logPath, "utf8")).trim().split(/\r?\n/);
      assert.deepEqual(calls, expected ? [`affinity:${expected}`, "work"] : ["work"]);
      if (probeFails) assert.match(result.stdout, /无法保证发布 CPU 上限/);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
}

test("root test groups preserve every file once, including production UI tests", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    const uiDir = join(fixture.repoDir, "src", "app", "production", "execution");
    await mkdir(uiDir, { recursive: true });
    await writeFile(join(uiDir, "behavior.test.mjs"), "export {};\n");
    const result = spawnSync(bash, ["-s"], {
      cwd: fixture.repoDir,
      input: `set -Eeuo pipefail\nDEPLOY_WORK_PREFIX=()\nlog() { echo "$*"; }\n${resourceHelpers}\nnode() { printf '%s\\n' "$@"; }\nrun_script_tests scripts\nrun_script_tests deploy\n`,
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(lines, ["--test", "--test-concurrency=2", "scripts/business.test.mjs", "src/app/production/execution/behavior.test.mjs",
      "--test", "--test-concurrency=2", "scripts/deploy-baseline.test.mjs", "scripts/deploy-change-plan.test.mjs", "scripts/test-postgres-release.test.mjs"]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

for (const compressor of ["pigz", "gzip"]) {
  test(`backup ${compressor} uses the shared resource budget and low compression`, { skip: !bash }, () => {
    const helper = deploySource.slice(deploySource.indexOf("compress_backup_stream()"), deploySource.indexOf("backup_file_path()"));
    const result = spawnSync(bash, ["-s"], {
      input: `set -Eeuo pipefail\n${helper}\n
limited_run() { printf 'limited:'; "$@"; }
pigz() { printf 'pigz:%s\\n' "$*"; }
gzip() { printf 'gzip:%s\\n' "$*"; }
command() { if [ "\${2:-}" = pigz ]; then return ${compressor === "pigz" ? 0 : 1}; fi; builtin command "$@"; }
compress_backup_stream\n`,
      encoding: "utf8", timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), compressor === "pigz" ? "limited:pigz:-1 -p 1" : "limited:gzip:-1");
  });
}

function runQualityGate(overrides = {}) {
  const start = deploySource.indexOf('if [ "$DEPLOY_USING_ARTIFACT" = 1 ]; then\n  log "构建环境');
  const end = deploySource.indexOf("# ----------------- 6. 数据库备份收口", start);
  assert.ok(start >= 0 && end > start, "unable to locate the real deployment quality gate");
  // Execute the production branch itself; all commands are shell functions, so no
  // build, deployment, package manager or database is invoked by this test.
  const input = `set -Eeuo pipefail
CACHE_DIR=unused-test-cache
log() { printf 'log:%s\\n' "$*"; }
start_stage() { printf 'start:%s\\n' "$*"; }
finish_stage() { printf 'finish:%s\\n' "$*"; }
skip_stage() { printf 'skip:%s\\n' "$*"; }
die() { printf 'failure:%s\\n' "$*"; exit 1; }
npx() { printf 'command:npx %s\\n' "$*"; }
npm() { printf 'command:npm %s\\n' "$*"; [ "$*" != "\${DEPLOY_TEST_FAILURE:-}" ]; }
bash() { printf 'command:bash %s\\n' "$*"; [ "\${DEPLOY_TEST_FAILURE:-}" != "postgres" ]; }
node() { printf 'command:node %s\\n' "$*"; }
limited_run() { "$@"; }
run_script_tests() { printf 'command:root-tests %s\\n' "$*"; [ "\${DEPLOY_TEST_FAILURE:-}" != "scripts" ]; }
commit_quality_plan() { if [ -z "\${1:-}" ]; then printf 'quality-saved\\n'; else printf 'group-saved:%s\\n' "$1"; fi; }
${deploySource.slice(start, end)}
printf 'gate-complete\\n'
`;
  return spawnSync(bash, ["-s"], {
    input,
    env: {
      ...process.env,
      DEPLOY_PLAN_FRONTEND: "0",
      DEPLOY_PLAN_API: "0",
      DEPLOY_PLAN_QUALITY: "0",
      DEPLOY_PLAN_PRISMA: "0",
      DEPLOY_PLAN_MIGRATIONS: "0",
      DEPLOY_CHECK_FRONTEND_TYPE: "0",
      DEPLOY_CHECK_API_TYPE: "0",
      DEPLOY_CHECK_SCRIPTS: "0",
      DEPLOY_CHECK_DEPLOY: "0",
      DEPLOY_CHECK_API: "0",
      DEPLOY_CHECK_API_CONTRACTS: "0",
      DEPLOY_PREPARE_ONLY: "0",
      DEPLOY_USING_ARTIFACT: "0",
      DEPLOY_CHECK_POSTGRES: "0",
      DEPLOY_RUN_TESTS: "1",
      DEPLOY_TEST_FAILURE: "",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 5_000,
  });
}

const frontendTypecheck = "npx --no-install tsc --noEmit -p tsconfig.json";
const apiTypecheck = "node apps/api/scripts/run-tests.cjs --compile-only";
const frontendTests = "root-tests scripts";
const apiTests = "npm --prefix apps/api run test:ts";
const postgresTests = ["applicant-forms", "audit-receipts", "chat-workspace", "procurement-rollback", "rd-documents"]
  .map((suite) => `bash scripts/test-postgres-release.sh --suite ${suite}`);
for (const [name, env, commands, status = 0] of [
  ["contracts fail before the full API suite", { DEPLOY_CHECK_API: "1", DEPLOY_CHECK_API_CONTRACTS: "1", DEPLOY_TEST_FAILURE: "--prefix apps/api run test:mts" }, ["npm --prefix apps/api run test:mts"], 1],
  ["only the failed PostgreSQL suite reruns", { DEPLOY_CHECK_POSTGRES: "0", DEPLOY_CHECK_POSTGRES_RD_DOCUMENTS: "1" }, [postgresTests[4]]],
  ["frontend checks are independently selected", { DEPLOY_CHECK_FRONTEND_TYPE: "1", DEPLOY_CHECK_SCRIPTS: "1" }, [frontendTypecheck, frontendTests]],
  ["API checks run with five separately timed database suites", { DEPLOY_CHECK_API_TYPE: "1", DEPLOY_CHECK_API: "1", DEPLOY_CHECK_POSTGRES: "1" }, [apiTypecheck, apiTests, ...postgresTests]],
  ["deployment regression group is independently selected", { DEPLOY_CHECK_DEPLOY: "1" }, ["root-tests deploy"]],
  ["database checks do not depend on build selection", { DEPLOY_CHECK_POSTGRES: "1" }, postgresTests],
  ["verified unchanged inputs reuse checks", {}, []],
  ["explicit disable does not save proof", { DEPLOY_CHECK_FRONTEND_TYPE: "1", DEPLOY_RUN_TESTS: "0" }, []],
  ["frontend test failure blocks release", { DEPLOY_CHECK_FRONTEND_TYPE: "1", DEPLOY_CHECK_SCRIPTS: "1", DEPLOY_TEST_FAILURE: "scripts" }, [frontendTypecheck, frontendTests], 1],
  ["API test failure blocks release", { DEPLOY_CHECK_API_TYPE: "1", DEPLOY_CHECK_API: "1", DEPLOY_TEST_FAILURE: "--prefix apps/api run test:ts" }, [apiTypecheck, apiTests], 1],
  ["isolated database failure blocks release", { DEPLOY_CHECK_API_TYPE: "1", DEPLOY_CHECK_API: "1", DEPLOY_CHECK_POSTGRES: "1", DEPLOY_TEST_FAILURE: "postgres" }, [apiTypecheck, apiTests, postgresTests[0]], 1],
]) {
  test(`quality gate: ${name}`, { skip: !bash }, () => {
    const result = runQualityGate(env);
    assert.equal(result.error, undefined);
    assert.equal(result.status, status, result.stdout + result.stderr);
    assert.deepEqual(result.stdout.split(/\r?\n/).filter((line) => line.startsWith("command:")).map((line) => line.slice(8)), commands);
    assert.equal(result.stdout.includes("gate-complete"), status === 0);
    assert.equal(result.stdout.includes("quality-saved"), status === 0 && env.DEPLOY_RUN_TESTS !== "0");
  });
}

test("isolated database failure prevents production migration and restart", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeFile(join(fixture.repoDir, "scripts", "test-postgres-release.sh"), "echo isolated-pg-failure\nexit 23\n");
    await writeStub(fixture.binDir, "npx", 'if [[ "$*" == *"migrate deploy"* ]]; then touch "$REPO_DIR/migrated"; fi');
    await writeStub(fixture.binDir, "pm2", 'touch "$REPO_DIR/restarted"');
    const result = runFakeDeployment(bash, fixture);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /isolated-pg-failure/);
    await assert.rejects(readFile(join(fixture.repoDir, "migrated")));
    await assert.rejects(readFile(join(fixture.repoDir, "restarted")));
    const records = (await readdir(fixture.metricsDir)).filter((name) => name.endsWith(".json"));
    const record = JSON.parse(await readFile(join(fixture.metricsDir, records[0]), "utf8"));
    assert.equal(record.stages.find((stage) => stage.name === "tests_postgres_applicant_forms")?.status, "failed");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

for (const selected of ["python3.11", "python3.9"]) {
  test(`native dependency installation selects compatible ${selected} before postinstall`, { skip: !bash }, async () => {
    const fixture = await createFakeDeployment();
    try {
      await writeStub(fixture.binDir, "python3", "exit 1"); // The server's default Python 3.6 cannot build node-gyp 11.
      await writeStub(fixture.binDir, "python3.11", selected === "python3.11" ? "exit 0" : "exit 1");
      await writeStub(fixture.binDir, "python3.9", "exit 0");
      await writeStub(fixture.binDir, "pnpm", `
printf '%s\\n' "\${PYTHON:-}" > "$REPO_DIR/install-python.txt"
"\${PYTHON:-python3}" -c 'import sys; sys.exit(sys.version_info < (3, 8))'`);
      const result = runFakeDeployment(bash, fixture, { PYTHON: "", DEPLOY_METRICS_ENABLED: "0" });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal((await readFile(join(fixture.repoDir, "install-python.txt"), "utf8")).trim(), bashPath(join(fixture.binDir, selected)));
      assert.equal(JSON.parse(await readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json"), "utf8")).ok, true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test("explicit PYTHON is preserved for installation and argon2 source rebuild", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    const nativeDir = join(fixture.repoDir, "node_modules", ".pnpm", "argon2@0.44.0", "node_modules", "argon2");
    await mkdir(nativeDir, { recursive: true });
    await writeStub(fixture.binDir, "python3.11", "exit 0");
    await writeStub(fixture.binDir, "custom-python", "exit 0");
    await writeStub(fixture.binDir, "pnpm", `printf '%s\\n' "$PYTHON" > "$REPO_DIR/install-python.txt"`);
    await writeStub(fixture.binDir, "node-gyp", `printf '%s\\n' "$*" > "$REPO_DIR/native-build-args.txt"\ntouch native-built`);
    await writeStub(fixture.binDir, "node", `
if [ "\${1:-}" = "--version" ]; then echo v22.22.1; exit 0; fi
if [ "\${1:-}" = "-e" ] && [ "\${2:-}" = "require('.')" ]; then test -f native-built; exit $?; fi
if [ "\${1:-}" = "-e" ]; then exec "${bashPath(process.execPath)}" "$@"; fi
exit 0`);
    const python = bashPath(join(fixture.binDir, "custom-python"));
    const result = runFakeDeployment(bash, fixture, { PYTHON: python, DEPLOY_METRICS_ENABLED: "0" });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal((await readFile(join(fixture.repoDir, "install-python.txt"), "utf8")).trim(), python);
    assert.equal((await readFile(join(fixture.repoDir, "native-build-args.txt"), "utf8")).trim(), `rebuild --python ${python}`);
    await access(join(nativeDir, "native-built"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed frozen dependency installation blocks release instead of falling back", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    const cache = join(fixture.repoDir, ".deploy-cache");
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "quality-inputs.json"), '{"previous":"proof"}');
    await writeStub(fixture.binDir, "pnpm", `
printf '%s\\n' "$*" >> "$REPO_DIR/install-calls.txt"
case "$*" in *--frozen-lockfile*) exit 42 ;; *) exit 0 ;; esac`);
    const result = runFakeDeployment(bash, fixture);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const calls = (await readFile(join(fixture.repoDir, "install-calls.txt"), "utf8")).trim().split("\n");
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.includes("--frozen-lockfile")));
    await assert.rejects(readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json")));
    await assert.rejects(readFile(join(fixture.webRoot, "version.json")));
    await assert.rejects(readFile(join(cache, "quality-inputs.json")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a missing pnpm lockfile blocks installation and activation", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await rm(join(fixture.repoDir, "pnpm-lock.yaml"));
    await writeStub(fixture.binDir, "npm", 'touch "$REPO_DIR/npm-was-called"');
    const result = runFakeDeployment(bash, fixture);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /pnpm-lock.yaml/);
    await assert.rejects(readFile(join(fixture.repoDir, "npm-was-called")));
    await assert.rejects(readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("missing pnpm cannot silently switch deployment to npm", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeStub(fixture.binDir, "npm", 'touch "$REPO_DIR/npm-was-called"');
    const result = runFakeDeployment(bash, fixture, {}, `
command() {
  if [ "\${1:-}" = "-v" ] && [ "\${2:-}" = "pnpm" ]; then return 1; fi
  builtin command "$@"
}`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /缺少 pnpm/);
    await assert.rejects(readFile(join(fixture.repoDir, "npm-was-called")));
    await assert.rejects(readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a manifest-only change invalidates the installation cache and rechecks the lockfile", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeFile(join(fixture.repoDir, "apps", "api", "package.json"), "{}\n");
    const first = runFakeDeployment(bash, fixture, { DEPLOY_METRICS_ENABLED: "0" });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const previousHealth = await readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json"), "utf8");
    await writeFile(join(fixture.repoDir, "apps", "api", "package.json"), '{"dependencies":{"synthetic-package":"2.0.0"}}\n');
    await writeStub(fixture.binDir, "pnpm", `
printf '%s\\n' "$*" >> "$REPO_DIR/install-calls.txt"
exit 42`);
    const second = runFakeDeployment(bash, fixture, { DEPLOY_METRICS_ENABLED: "0" });
    assert.equal(second.status, 1, second.stdout + second.stderr);
    const calls = (await readFile(join(fixture.repoDir, "install-calls.txt"), "utf8")).trim().split("\n");
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.includes("--frozen-lockfile")));
    assert.equal(await readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json"), "utf8"), previousHealth);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the minimum supported Node version reaches a successful deployment", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeStub(fixture.binDir, "node", `if [ "\${1:-}" = "--version" ]; then echo v22.19.0; exit 0; fi\nexec "${bashPath(process.execPath)}" "$@"`);
    const result = runFakeDeployment(bash, fixture, { DEPLOY_METRICS_ENABLED: "0" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(await readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json"), "utf8")).ok, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("unsupported Node versions fail before dependency installation", { skip: !bash }, async () => {
  for (const version of ["v20.20.0", "v22.18.0"]) {
    const fixture = await createFakeDeployment();
    try {
      await writeStub(fixture.binDir, "node", `if [ "\${1:-}" = "--version" ]; then echo ${version}; exit 0; fi\nexec "${bashPath(process.execPath)}" "$@"`);
      await writeStub(fixture.binDir, "pnpm", 'touch "$REPO_DIR/pnpm-was-called"');
      const result = runFakeDeployment(bash, fixture);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /Node.*22\.19/);
      await assert.rejects(readFile(join(fixture.repoDir, "pnpm-was-called")));
      await assert.rejects(readFile(join(fixture.repoDir, ".deploy-cache", "app-health.json")));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("deployment baseline declares the complete stage order", () => {
  const stages = configuredStages();
  assert.deepEqual(stages, expectedStages);
  assert.equal(new Set(stages).size, stages.length);
});

test("quality timing records each executed group in order", { skip: !bash }, () => {
  const result = runQualityGate(Object.fromEntries(["FRONTEND_TYPE", "API_TYPE", "SCRIPTS", "DEPLOY", "API", "API_CONTRACTS", "POSTGRES"]
    .map((name) => [`DEPLOY_CHECK_${name}`, "1"])));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.stdout.split(/\r?\n/).filter((line) => line.startsWith("start:")).map((line) => line.slice(6)),
    expectedStages.slice(3, 14));
  assert.equal(result.stdout.split(/\r?\n/).filter((line) => line === "finish:success").length, 11);
});

test("deployment failures retain the original stage, line and exit code", () => {
  assert.match(deploySource, /trap 'on_deploy_error "\$\?" "\$LINENO"' ERR/);
  assert.match(deploySource, /trap 'on_deploy_exit "\$\?"' EXIT/);
  assert.match(deploySource, /DEPLOY_FAILED_STAGE="\$\{DEPLOY_CURRENT_STAGE:-\$DEPLOY_FAILED_STAGE\}"/);
  assert.match(deploySource, /DEPLOY_FAILURE_LINE="\$\{DEPLOY_FAILURE_LINE:-\$failed_line\}"/);
  assert.match(deploySource, /finalize_deploy_metrics "\$deploy_status" "\$exit_code"/);
  assert.match(deploySource, /DEPLOY_METRICS_FINALIZED=1/);
  assert.match(deploySource, /exit "\$exit_code"/);
});

test("baseline output is allowlisted and never serializes deployment secrets", () => {
  const jsonStart = deploySource.indexOf("printf '  \"schema_version\": 1");
  const jsonEnd = deploySource.indexOf('} > "$temp_path"', jsonStart);
  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, "unable to locate baseline JSON writer");
  const jsonWriter = deploySource.slice(jsonStart, jsonEnd);

  for (const field of [
    "release",
    "git_sha",
    "branch",
    "operator",
    "host",
    "trigger",
    "node_version",
    "status",
    "exit_code",
    "started_at",
    "ended_at",
    "duration_ms",
    "duration_seconds",
    "failed_stage",
    "failed_line",
    "resource_scope",
    "system_peak_cpu_percent",
    "system_peak_memory_used_kb",
    "system_memory_total_kb",
    "resource_samples",
    "stages",
  ]) {
    assert.match(jsonWriter, new RegExp(`"${field}"`), `missing allowlisted field ${field}`);
  }

  assert.doesNotMatch(jsonWriter, /DATABASE_URL|NPM_REGISTRY|PRISMA_MIRROR|TOKEN|PASSWORD|PRIVATE_KEY/);
  assert.doesNotMatch(jsonWriter, /DEPLOY_FAILURE_REASON|failure_reason/);
  assert.doesNotMatch(deploySource, /\bprintenv\b|set\s+-x/);
});

test("metrics failures are best-effort and release filenames are constrained", () => {
  assert.match(deploySource, /发布基线目录不可创建[\s\S]*?return 0/);
  assert.match(deploySource, /阶段指标写入失败；部署继续执行/);
  assert.match(deploySource, /发布基线 JSON 生成失败；部署结果不受影响/);
  assert.match(deploySource, /\*\[!a-zA-Z0-9\._-\]\*/);
  assert.match(deploySource, /final_path="\$DEPLOY_METRICS_DIR\/\$release_name-\$\$\.json"/);
});

test("resource sampling is numeric, optional and does not expose process commands", () => {
  assert.match(deploySource, /\[ -r \/proc\/stat \] && \[ -r \/proc\/meminfo \]/);
  assert.match(deploySource, /system_peak_cpu_percent/);
  assert.match(deploySource, /system_peak_memory_used_kb/);
  assert.match(deploySource, /resource_samples/);
  assert.doesNotMatch(deploySource, /pidstat[^\n]*-l|\/proc\/[^\n]*cmdline/);
});

test("fake deployment writes one parseable, secret-free baseline without real infrastructure", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    const result = runFakeDeployment(bash, fixture);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const files = (await readdir(fixture.metricsDir)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1, `${result.stdout}\n${result.stderr}`);
    const text = await readFile(join(fixture.metricsDir, files[0]), "utf8");
    const record = JSON.parse(text);

    assert.equal(record.status, "success");
    assert.equal(record.mode, "source-deploy");
    assert.equal(record.exit_code, 0);
    assert.equal(record.git_sha, "0123456789abcdef0123456789abcdef01234567");
    assert.equal(record.operator, 'qa"\noperator');
    assert.ok(Number.isFinite(record.duration_ms) && record.duration_ms >= 0);
    assert.deepEqual(record.stages.map((stage) => stage.name), expectedStages);
    assert.equal(record.stages.length, expectedStages.length);
    assert.ok(record.stages.every((stage) => Number.isFinite(stage.duration_ms) && stage.duration_ms >= 0));
    assert.equal(record.stages.find((stage) => stage.name === "database_backup")?.status, "skipped");
    assert.equal(record.stages.find((stage) => stage.name === "frontend_readiness")?.status, "success");
    assert.deepEqual((await readFile(join(fixture.repoDir, '.deploy-cache/frontend-http-call'), 'utf8')).trim().split(/\r?\n/), ["https://public.example.invalid/", bashPath(fixture.webRoot)]);
    assert.doesNotMatch(text, /secret-user|secret-password|secret-host|secret-db/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("UTF-8 deployment messages preserve variable boundaries and intended results", {
  skip: !bash ? "Bash unavailable" : !utf8Locale ? "UTF-8 locale unavailable" : false,
}, async (t) => {
  // Explicitly exercise UTF-8 even when the parent test process uses LC_ALL=C.
  // Bash 3.2 can otherwise absorb bytes of adjacent Chinese punctuation into a bare variable name.
  for (const scenario of ["metrics disabled", "metrics unwritable", "frontend missing"]) {
    await t.test(scenario, async () => {
      const fixture = await createFakeDeployment();
      try {
        const overrides = { LC_ALL: utf8Locale, LANG: utf8Locale };
        if (scenario === "metrics unwritable") {
          const blockedPath = join(fixture.root, "metrics-is-a-file");
          await writeFile(blockedPath, "not a directory", "utf8");
          overrides.DEPLOY_METRICS_DIR = bashPath(blockedPath);
        } else {
          overrides.DEPLOY_METRICS_ENABLED = "0";
        }
        if (scenario === "frontend missing") {
          overrides.WEB_ROOT = bashPath(join(fixture.root, "missing-web-root"));
        }

        const result = runFakeDeployment(bash, fixture, overrides);
        const output = `${result.stdout}\n${result.stderr}`;
        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, scenario === "frontend missing" ? 1 : 0, output);
        assert.doesNotMatch(output, /unbound variable|�/);
        assert.match(output, /变更感知已禁用（DEPLOY_CHANGE_PLAN=0），执行全量发布。/);
        if (scenario === "metrics unwritable") {
          assert.ok(output.includes(`发布基线目录不可创建：${overrides.DEPLOY_METRICS_DIR}；`), output);
        } else {
          assert.match(output, /发布基线采集已禁用（DEPLOY_METRICS_ENABLED=0）。/);
        }
        if (scenario === "frontend missing") {
          assert.ok(output.includes(`前端发布目录不存在：${overrides.WEB_ROOT}（`), output);
        }
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("unwritable metrics target cannot change a successful deployment exit code", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    const blockedPath = join(fixture.root, "metrics-is-a-file");
    await writeFile(blockedPath, "not a directory", "utf8");
    const result = runFakeDeployment(bash, fixture, { DEPLOY_METRICS_DIR: bashPath(blockedPath) });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /发布基线目录不可创建/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed fake deployment records one failed stage and preserves the exit code", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeStub(fixture.binDir, "pm2", "exit 23");
    const result = runFakeDeployment(bash, fixture);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 23, `${result.stdout}\n${result.stderr}`);

    const files = (await readdir(fixture.metricsDir)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1, `${result.stdout}\n${result.stderr}`);
    const record = JSON.parse(await readFile(join(fixture.metricsDir, files[0]), "utf8"));
    assert.equal(record.status, "failed");
    assert.equal(record.exit_code, 23);
    assert.equal(record.failed_stage, "api_restart");
    assert.equal(record.stages.length, expectedStages.length);
    assert.equal(record.stages.find((stage) => stage.name === "api_restart")?.status, "failed");
    assert.equal(record.stages.find((stage) => stage.name === "nginx_reload")?.status, "skipped");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failure inside a deployment subshell still produces one final record", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeStub(fixture.binDir, "npx", "exit 19");
    const result = runFakeDeployment(bash, fixture);
    assert.equal(result.error, undefined, result.error?.message);
    // retry() intentionally normalizes an exhausted command to exit code 1.
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);

    const files = (await readdir(fixture.metricsDir)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1, `${result.stdout}\n${result.stderr}`);
    const record = JSON.parse(await readFile(join(fixture.metricsDir, files[0]), "utf8"));
    assert.equal(record.status, "failed");
    assert.equal(record.exit_code, 1);
    assert.equal(record.failed_stage, "prisma_generate");
    assert.equal(record.stages.find((stage) => stage.name === "prisma_generate")?.status, "failed");
    assert.equal(record.stages.find((stage) => stage.name === "api_build")?.status, "skipped");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a second unchanged deployment skips every runtime stage", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await enableChangePlanner(fixture);
    const overrides = {
      DEPLOY_CHANGE_PLAN: "1",
      DEPLOY_METRICS_ENABLED: "0",
    };
    const first = runFakeDeployment(bash, fixture, overrides);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout, /发布计划\[first-release\]/);

    const second = runFakeDeployment(bash, fixture, overrides);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /发布计划\[incremental\].*frontend=0 api=0 prisma=0 migrations=0 quality=0/);
    assert.match(second.stdout, /前端输入未变化，跳过前端构建/);
    assert.match(second.stdout, /API 输入未变化，跳过后端构建/);
    assert.match(second.stdout, /数据库 migration 未变化，跳过备份/);
    assert.match(second.stdout, /API 未变化，跳过 PM2 重启/);
    assert.doesNotMatch(second.stdout, /构建前端 \.\.\.|重启后端 pm2/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a busy release lock stops before checkout or installation", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeStub(fixture.binDir, 'flock', 'exit 75');
    await writeStub(fixture.binDir, 'pnpm', 'touch "$REPO_DIR/install-started"');
    const result = runFakeDeployment(bash, fixture, { DEPLOY_LOCK_HELD: '' });
    assert.equal(result.status, 75, result.stdout + result.stderr);
    assert.match(result.stderr, /已有发布正在执行/);
    await assert.rejects(readFile(join(fixture.repoDir, 'install-started')));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("Git hook locks before checkout and deploys the received commit, not a moving branch", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  const hook = join(fixture.root, 'post-receive');
  const sha = '1234567890abcdef1234567890abcdef12345678';
  try {
    await writeFile(hook, await readFile(new URL('../deploy/git-hooks/post-receive', import.meta.url)));
    await writeFile(join(fixture.root, 'shell-env'), 'export PATH="$DEPLOY_TEST_PATH"\n');
    await writeStub(fixture.binDir, 'git', 'printf "%s\\n" "$*" > "$DEPLOY_WORK_TREE/checkout.txt"');
    await writeFile(join(fixture.repoDir, 'scripts/deploy.sh'), 'printf "%s\\n%s\\n" "$DEPLOY_GIT_SHA" "$DEPLOY_LOCK_HELD" > "$REPO_DIR/release.txt"\n');
    const run = () => spawnSync(bash, [bashPath(hook)], {
      input: `0000000000000000000000000000000000000000 ${sha} refs/heads/main\n`, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${bashPath(fixture.binDir)}:/usr/bin:/bin`, DEPLOY_TEST_PATH: `${bashPath(fixture.binDir)}:/usr/bin:/bin`, BASH_ENV: bashPath(join(fixture.root, 'shell-env')), DEPLOY_WORK_TREE: bashPath(fixture.repoDir), DEPLOY_BARE_DIR: bashPath(join(fixture.root, 'bare')), NVM_DIR: bashPath(join(fixture.root, 'no-nvm')), DEPLOY_LOCK_HELD: '' },
    });
    let result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(await readFile(join(fixture.repoDir, 'checkout.txt'), 'utf8'), new RegExp(`checkout -f ${sha}`));
    assert.match(await readFile(join(fixture.repoDir, 'release.txt'), 'utf8'), new RegExp(`^${sha}\\n.+repo`));
    await rm(join(fixture.repoDir, 'checkout.txt'));
    await mkdir(join(fixture.root, 'bare/hooks'), { recursive: true });
    await writeFile(join(fixture.root, 'bare/hooks/artifact-root'), bashPath(join(fixture.root, 'inbox')) + '\n');
    result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    await assert.rejects(readFile(join(fixture.repoDir, 'checkout.txt')));
    await mkdir(join(fixture.root, 'inbox', sha), { recursive: true });
    await writeFile(join(fixture.root, 'inbox', sha, 'manifest.json'), '{}');
    result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await readFile(join(fixture.repoDir, 'checkout.txt'));
    await rm(join(fixture.repoDir, 'checkout.txt'));
    await writeStub(fixture.binDir, 'flock', 'exit 75');
    result = run();
    assert.equal(result.status, 75, result.stdout + result.stderr);
    await assert.rejects(readFile(join(fixture.repoDir, 'checkout.txt')));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("saving a successful group never resurrects invalid prior proof", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  const cache = join(fixture.repoDir, '.deploy-cache');
  const candidate = join(cache, 'candidate.json');
  const previous = join(cache, 'quality-inputs.json');
  const snapshot = { schema_version: 1, fingerprints: { source: 'a'.repeat(64) }, checks: { frontend_type: 'b'.repeat(64), api_tests: 'c'.repeat(64) } };
  const helper = deploySource.slice(deploySource.indexOf('commit_quality_plan() {'), deploySource.indexOf('commit_change_plan() {'));
  try {
    await mkdir(cache, { recursive: true });
    await writeFile(candidate, JSON.stringify(snapshot));
    for (const prior of [
      { ...snapshot, schema_version: 0 },
      { ...snapshot, fingerprints: {} },
      { ...snapshot, checks: { ...snapshot.checks, frontend_type: 'broken' } },
    ]) {
      await writeFile(previous, JSON.stringify(prior));
      const result = spawnSync(bash, ['-s'], {
        input: `set -Eeuo pipefail\nCACHE_DIR="${bashPath(cache)}"\nDEPLOY_PLAN_CANDIDATE_FILE="${bashPath(candidate)}"\nnode() { "${bashPath(process.execPath)}" "$@"; }\nlog() { :; }\n${helper}\ncommit_quality_plan frontend_type\n`,
        encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(await readFile(previous, 'utf8')).checks, { frontend_type: snapshot.checks.frontend_type });
    }
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("unchanged source with lost output rebuilds and revokes stale API incremental state", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await enableChangePlanner(fixture);
    const apiChunk = join(fixture.repoDir, 'apps/api/dist/src/dependency.js');
    const info = join(fixture.repoDir, 'apps/api/dist/tsconfig.build.tsbuildinfo');
    const webChunk = join(fixture.repoDir, 'dist/chunk.js');
    await writeFile(apiChunk, 'original api');
    await writeFile(webChunk, 'original web');
    await writeFile(info, 'incremental state');
    const overrides = { DEPLOY_CHANGE_PLAN: '1', DEPLOY_METRICS_ENABLED: '0' };
    let result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await rm(apiChunk);
    await rm(webChunk);
    await writeStub(fixture.binDir, 'npm', `
if [ "$*" = '--prefix apps/api run build' ]; then
  [ ! -e apps/api/dist/tsconfig.build.tsbuildinfo ] || exit 99
  printf 'recovered api' > apps/api/dist/src/dependency.js
elif [ "$*" = 'run build' ]; then
  printf 'recovered web' > dist/chunk.js
else exit 98
fi`);
    result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await readFile(apiChunk, 'utf8'), 'recovered api');
    assert.equal(await readFile(webChunk, 'utf8'), 'recovered web');
    assert.doesNotMatch(result.stdout, /质量检查记录已保存：(?:api_tests|api_contracts)/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("prepared artifacts deploy without rebuilding or testing and corruption blocks activation", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await enableChangePlanner(fixture);
    const artifact = join(fixture.root, 'artifact');
    const calls = join(fixture.root, 'calls.log');
    await writeStub(fixture.binDir, 'npm', 'echo "$*" >> "$DEPLOY_CALL_LOG"');
    const overrides = { DEPLOY_CHANGE_PLAN: '1', DEPLOY_METRICS_ENABLED: '1', DEPLOY_GIT_SHA: 'a'.repeat(40),
      DEPLOY_ARTIFACT_DIR: bashPath(artifact), DEPLOY_CALL_LOG: bashPath(calls) };
    let result = runFakeDeployment(bash, fixture, { ...overrides, DEPLOY_PREPARE_ONLY: '1' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /重启后端 pm2|执行 prisma migrate deploy|发布前端 dist|启动后台数据库备份/);
    await readFile(join(artifact, 'manifest.json'));
    const preparedMetrics = (await readdir(fixture.metricsDir)).find(name => name.endsWith('.json'));
    const preparedRecord = JSON.parse(await readFile(join(fixture.metricsDir, preparedMetrics), 'utf8'));
    assert.equal(preparedRecord.mode, 'prepare');
    assert.equal(preparedRecord.stages.find((stage) => stage.name === 'frontend_readiness')?.status, 'skipped');
    await assert.rejects(readFile(join(fixture.repoDir, '.deploy-cache/frontend-http-call')));
    await assert.rejects(readFile(join(fixture.repoDir, '.deploy-cache/deploy-inputs.json')));
    // Reject every build/test command now. Only a verified artifact may bypass them.
    await writeStub(fixture.binDir, 'npm', 'echo "$*" >> "$DEPLOY_CALL_LOG"; exit 29');
    result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /已载入通过验收的版本/);
    await readFile(join(fixture.repoDir, '.deploy-cache/frontend-http-call'));
    const modes = await Promise.all((await readdir(fixture.metricsDir)).filter(name => name.endsWith('.json'))
      .map(async name => JSON.parse(await readFile(join(fixture.metricsDir, name), 'utf8')).mode));
    assert.ok(modes.includes('artifact-deploy'));
    assert.equal(await readFile(join(fixture.webRoot, 'index.html'), 'utf8'), '<main>build fixture</main>');
    await writeFile(join(artifact, 'dist/index.html'), 'corrupt');
    result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /重启后端 pm2|执行 prisma migrate deploy/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("successful quality groups survive a later failure but never certify failed groups", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  const proof = join(fixture.repoDir, ".deploy-cache", "quality-inputs.json");
  try {
    await enableChangePlanner(fixture);
    const overrides = { DEPLOY_CHANGE_PLAN: "1", DEPLOY_METRICS_ENABLED: "0" };
    let result = runFakeDeployment(bash, fixture, { ...overrides, DEPLOY_RUN_TESTS: "0" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await assert.rejects(readFile(proof));

    // A successful publish with disabled checks is not evidence for the next gate.
    await writeStub(fixture.binDir, "npm", 'if [ "$*" = "--prefix apps/api run test:ts" ]; then exit 29; fi');
    result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /API 测试未通过/);
    const partial = JSON.parse(await readFile(proof, "utf8"));
    assert.ok(partial.checks.frontend_type);
    assert.ok(partial.checks.api_type);
    assert.ok(partial.checks.scripts_tests);
    assert.ok(partial.checks.deploy_tests);
    assert.equal(partial.checks.api_tests, undefined);
    assert.equal(partial.checks.postgres, undefined);

    // Retry the unchanged failed publish: prior checks are skipped, failed API checks still run.
    result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /API 测试未通过/);
    assert.doesNotMatch(result.stdout, /质量检查记录已保存：(frontend_type|api_type|scripts_tests|deploy_tests)/);

    await writeStub(fixture.binDir, "npm");
    await writeFile(join(fixture.repoDir, "apps", "api", "src", "main.ts"), "export const api = 2;\n");
    await writeStub(fixture.binDir, "pm2", "exit 23");
    result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 23, result.stdout + result.stderr);
    const verified = await readFile(proof, "utf8");
    assert.ok(JSON.parse(verified).checks);

    // The exact same verified inputs can retry the failed restart without repeating checks.
    await writeStub(fixture.binDir, "npm", 'if [ "$*" = "--prefix apps/api run test:ts" ]; then exit 29; fi');
    await writeStub(fixture.binDir, "pm2", `
if [ "\${1:-}" = start ] || [ "\${1:-}" = restart ]; then
  printf '{"ok":true,"database":"ready","git_sha":"%s","release":"%s"}\\n' "$APP_GIT_SHA" "$APP_VERSION" > "$REPO_DIR/.deploy-cache/app-health.json"
fi`);
    result = runFakeDeployment(bash, fixture, overrides);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await readFile(proof, "utf8"), verified);
    assert.match(result.stdout, /复用已完成的 api 构建/);

    // A forced full run that now fails must invalidate the earlier successful proof.
    result = runFakeDeployment(bash, fixture, { ...overrides, DEPLOY_CHANGE_PLAN: "0" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    await assert.rejects(readFile(proof));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("a frontend deployment cannot succeed or save its snapshot without WEB_ROOT", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await enableChangePlanner(fixture);
    await writeStub(fixture.binDir, 'npm', 'touch "$REPO_DIR/build-started"');
    const result = runFakeDeployment(bash, fixture, {
      DEPLOY_CHANGE_PLAN: "1",
      DEPLOY_METRICS_ENABLED: "0",
      WEB_ROOT: bashPath(join(fixture.root, "missing-web-root")),
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /前端发布目录不存在/);
    await assert.rejects(readFile(join(fixture.repoDir, 'build-started')));
    await assert.rejects(readFile(join(fixture.repoDir, ".deploy-cache", "deploy-inputs.json")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("empty frontend or API artifacts stop before production migration and restart", { skip: !bash }, async () => {
  for (const path of ['dist/index.html', 'apps/api/dist/src/main.js']) {
    const fixture = await createFakeDeployment();
    try {
      await writeFile(join(fixture.repoDir, path), '');
      await writeStub(fixture.binDir, 'pm2', 'touch "$REPO_DIR/restarted"');
      await writeStub(fixture.binDir, 'npx', 'touch "$REPO_DIR/database-command"');
      const result = runFakeDeployment(bash, fixture, { DEPLOY_METRICS_ENABLED: '0', DEPLOY_RUN_TESTS: '0' });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /构建产物缺失或为空/);
      await assert.rejects(readFile(join(fixture.repoDir, 'restarted')));
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  }
});

test("unready, stale-version or invalid health responses cannot publish the frontend or save a successful snapshot", { skip: !bash }, async () => {
  for (const response of [
    'exit 22',
    `printf '%s' '{"ok":true,"database":"ready","git_sha":"old","release":"old"}'`,
    `printf '%s' 'invalid json'`,
  ]) {
    const fixture = await createFakeDeployment();
    try {
      await enableChangePlanner(fixture);
      await writeFile(join(fixture.webRoot, "index.html"), "previous frontend", "utf8");
      await writeFile(join(fixture.repoDir, "dist", "index.html"), "new frontend", "utf8");
      await writeStub(fixture.binDir, "curl", response);
      const result = runFakeDeployment(bash, fixture, {
        DEPLOY_CHANGE_PLAN: "1",
        DEPLOY_HEALTH_TIMEOUT_SECONDS: "1",
      });
      assert.equal(result.error, undefined, `fake deployment process failed: ${result.error?.message}`);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}\n${result.stderr}`, /API 就绪检查失败/);
      assert.equal(await readFile(join(fixture.webRoot, "index.html"), "utf8"), "previous frontend");
      await assert.rejects(readFile(join(fixture.repoDir, ".deploy-cache", "deploy-inputs.json")));
      const files = (await readdir(fixture.metricsDir)).filter((name) => name.endsWith(".json"));
      const record = JSON.parse(await readFile(join(fixture.metricsDir, files[0]), "utf8"));
      assert.equal(record.status, "failed");
      assert.equal(record.failed_stage, "api_readiness");
      assert.equal(record.stages.find((stage) => stage.name === "frontend_activate")?.status, "skipped");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

async function runStaticPublication(transfer, failure = '') {
  const fixture = await createFakeDeployment();
  const events = join(fixture.root, 'chmod-events');
  const branch = join(fixture.root, 'transfer-branch');
  const secret = join(fixture.repoDir, 'apps/api/.env');
  const privateLog = join(fixture.root, 'deployment.log');
  const start = deploySource.indexOf('if [ "$DEPLOY_PLAN_FRONTEND" != "1" ]; then\n  log "前端未变化，跳过静态文件发布。"');
  const end = deploySource.indexOf('# ---------------------------- 10. nginx', start);
  assert.ok(start >= 0 && end > start, 'real static publication branch must be found');
  try {
    // Windows junctions exercise real find -P traversal without requiring the
    // elevated symbolic-link privilege. Neither private target may be chmod'ed.
    await symlink(join(fixture.repoDir, 'apps/api'), join(fixture.webRoot, 'linked-private'), process.platform === 'win32' ? 'junction' : 'dir');
    // Intercept chmod arguments while still executing the real command. Git Bash
    // on Windows does not enforce POSIX modes; the target set remains testable.
    await writeStub(fixture.binDir, 'chmod', `
printf '%s\\0' "$@" >> "$STATIC_CHMOD_EVENTS"
printf '\\0' >> "$STATIC_CHMOD_EVENTS"
${failure === 'chmod' ? 'exit 23' : 'PATH=/usr/bin:/bin exec chmod "$@"'}`);
    if (failure === 'find') await writeStub(fixture.binDir, 'find', 'exit 24');
    await writeStub(fixture.binDir, 'rsync', `
printf 'rsync' > "$STATIC_TRANSFER_BRANCH"
[ "$1" = -a ] && [ "$2" = --delete-after ] || exit 96
# This fixture preserves modes like rsync -a; no rsync installation is required.
command cp -a "$3/." "$4"`);
    const setup = `
set -Eeuo pipefail
export PATH="$DEPLOY_TEST_PATH"
umask 077
PATH=/usr/bin:/bin command chmod 0700 "$WEB_ROOT" "$REPO_DIR/dist"
mkdir -p "$REPO_DIR/dist/assets/nested directory"
printf 'restricted build' > "$REPO_DIR/dist/index.html"
printf 'javascript asset' > "$REPO_DIR/dist/assets/nested directory/app file.js"
printf 'private configuration' > "$STATIC_SECRET"
printf 'private deployment output' > "$STATIC_PRIVATE_LOG"
PATH=/usr/bin:/bin command chmod 0600 "$REPO_DIR/dist/index.html" "$STATIC_SECRET" "$STATIC_PRIVATE_LOG"
command() {
  if [ "\${1:-}" = -v ] && [ "\${2:-}" = rsync ]; then return ${transfer === 'rsync' ? '0' : '1'}; fi
  builtin command "$@"
}
cp() { printf 'cp' > "$STATIC_TRANSFER_BRANCH"; command cp "$@"; }
log() { :; }
start_stage() { printf 'start:%s\\n' "$1"; }
finish_stage() { printf 'finish:%s\\n' "$1"; }
skip_stage() { printf 'skip:%s\\n' "$1"; }
die() { printf 'failure:%s\\n' "$*"; exit 1; }
${deploySource.slice(start, end)}
printf 'publication-complete\\n'
`;
    const result = spawnSync(bash, ['-s'], {
      input: setup,
      cwd: fixture.repoDir,
      env: {
        ...process.env,
        DEPLOY_TEST_PATH: `${bashPath(fixture.binDir)}:/usr/bin:/bin`,
        WEB_ROOT: bashPath(fixture.webRoot), REPO_DIR: bashPath(fixture.repoDir),
        DEPLOY_PLAN_FRONTEND: '1', RELEASE: 'restricted-umask-test', GIT_SHA: '0123456',
        STATIC_CHMOD_EVENTS: bashPath(events), STATIC_TRANSFER_BRANCH: bashPath(branch),
        STATIC_SECRET: bashPath(secret), STATIC_PRIVATE_LOG: bashPath(privateLog),
      },
      encoding: 'utf8', timeout: 15_000,
    });
    const calls = (await readFile(events, 'utf8').catch(() => '')).split('\0\0').filter(Boolean).map((call) => call.split('\0'));
    return { fixture, result, calls, branch: await readFile(branch, 'utf8'), secret, privateLog };
  } catch (error) {
    await rm(fixture.root, { recursive: true, force: true });
    throw error;
  }
}

for (const transfer of ['rsync', 'cp']) {
  test(`static publication normalizes umask 077 artifacts only inside WEB_ROOT (${transfer})`, { skip: !bash }, async (t) => {
    const { fixture, result, calls, branch, secret, privateLog } = await runStaticPublication(transfer);
    try {
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(branch, transfer);
      assert.match(result.stdout, /finish:success[\s\S]*publication-complete/);
      const expected = new Map([
        [fixture.webRoot, 0o755],
        [join(fixture.webRoot, 'assets'), 0o755],
        [join(fixture.webRoot, 'assets/nested directory'), 0o755],
        [join(fixture.webRoot, 'index.html'), 0o644],
        [join(fixture.webRoot, 'version.json'), 0o644],
        [join(fixture.webRoot, 'assets/nested directory/app file.js'), 0o644],
      ].map(([path, mode]) => [bashPath(path), mode]));
      const actual = new Map();
      for (const [mode, ...args] of calls) {
        for (const path of args.filter((arg) => arg !== '--')) {
          assert.ok(expected.has(path), `permission change escaped static files: ${path}`);
          actual.set(path, Number.parseInt(mode, 8));
        }
      }
      assert.deepEqual(actual, expected, 'every static directory/file must receive the correct public mode');
      assert.equal(await readFile(join(fixture.webRoot, 'index.html'), 'utf8'), 'restricted build');
      assert.equal(await readFile(join(fixture.webRoot, 'assets/nested directory/app file.js'), 'utf8'), 'javascript asset');
      assert.deepEqual(JSON.parse(await readFile(join(fixture.webRoot, 'version.json'), 'utf8')), { release: 'restricted-umask-test', git_sha: '0123456' });
      assert.equal(await readFile(secret, 'utf8'), 'private configuration');
      assert.equal(await readFile(privateLog, 'utf8'), 'private deployment output');
      if (process.platform === 'win32') {
        t.diagnostic('Windows: real copy/find/chmod commands and scope verified; POSIX 755/644/600 enforcement requires Linux/macOS. rsync transfer uses a mode-preserving cp fixture.');
      } else {
        for (const [path, mode] of expected) assert.equal((await stat(path)).mode & 0o777, mode, path);
        for (const path of [secret, privateLog, join(fixture.repoDir, 'dist/index.html')]) assert.equal((await stat(path)).mode & 0o777, 0o600, path);
        assert.equal((await stat(join(fixture.repoDir, 'dist'))).mode & 0o777, 0o700);
      }
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  for (const failure of ['chmod', 'find']) {
    test(`static publication stops when ${failure} fails (${transfer})`, { skip: !bash }, async () => {
      const { fixture, result, calls } = await runStaticPublication(transfer, failure);
      try {
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0, result.stdout + result.stderr);
        if (failure === 'chmod') assert.ok(calls.length > 0, 'permission operation must actually be attempted');
        assert.doesNotMatch(result.stdout, /finish:success|publication-complete/);
      } finally { await rm(fixture.root, { recursive: true, force: true }); }
    });
  }
}

function runFinalPublicationChecks({ reload = '0', frontend = '0', failure = '' } = {}) {
  const start = deploySource.indexOf('# ---------------------------- 10. nginx');
  const failureStart = deploySource.indexOf('die() {');
  const failureEnd = deploySource.indexOf('retry() {', failureStart);
  assert.ok(start >= 0 && failureStart >= 0 && failureEnd > failureStart, 'real publication and failure handlers must be found');
  return spawnSync(bash, ['-s'], {
    input: `set -Eeuo pipefail
DEPLOY_CURRENT_STAGE=''
DEPLOY_FAILED_STAGE=''
DEPLOY_FAILURE_LINE=''
DEPLOY_PLAN_CANDIDATE_FILE=''
DEPLOY_COMPLETED=0
RELEASE=fixture-release
REPO_DIR=/fixture-repo
WEB_ROOT='/fixture static'
DEPLOY_FRONTEND_URL=https://public.example.invalid/
ts() { printf 'fixture-time'; }
log() { printf 'log:%s\\n' "$*"; }
start_stage() { DEPLOY_CURRENT_STAGE="$1"; printf 'start:%s\\n' "$1"; }
finish_stage() { printf 'stage:%s:%s\\n' "$DEPLOY_CURRENT_STAGE" "$1"; DEPLOY_CURRENT_STAGE=''; }
skip_stage() { printf 'stage:%s:skipped\\n' "$1"; }
cleanup_background_backup() { :; }
finalize_deploy_metrics() { printf 'result:%s:%s:%s:%s\\n' "$1" "$2" "$DEPLOY_FAILED_STAGE" "$DEPLOY_COMPLETED"; }
commit_change_plan() { printf 'snapshot-saved\\n'; }
command() {
  if [ "\${1:-}" = -v ] && [ "\${2:-}" = nginx ]; then [ "$FINAL_TEST_FAILURE" != missing-nginx ]; return; fi
  builtin command "$@"
}
nginx() {
  printf 'nginx:%s\\n' "$*" >&2
  [ "$FINAL_TEST_FAILURE:$*" != 'nginx-config:-t' ] && [ "$FINAL_TEST_FAILURE:$*" != 'nginx-reload:-s reload' ]
}
node() {
  [ "$#" = 3 ] && [[ "$1" == *deploy-frontend-readiness.mjs ]] \\
    && [ "$2" = "$DEPLOY_FRONTEND_URL" ] && [ "$3" = "$WEB_ROOT" ] || return 96
  printf 'frontend-http-check\\n'
  [ "$FINAL_TEST_FAILURE" != frontend-http ]
}
${deploySource.slice(failureStart, failureEnd)}
trap 'on_deploy_error "$?" "$LINENO"' ERR
trap 'on_deploy_exit "$?"' EXIT
${deploySource.slice(start)}
`,
    env: { ...process.env, DEPLOY_RELOAD_NGINX: reload, DEPLOY_PLAN_FRONTEND: frontend, FINAL_TEST_FAILURE: failure },
    encoding: 'utf8', timeout: 5_000,
  });
}

for (const frontend of ['0', '1']) {
  test(`final publication requires frontend HTTP acceptance even when frontend changed=${frontend}`, { skip: !bash }, () => {
    const result = runFinalPublicationChecks({ frontend });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /stage:nginx_reload:skipped[\s\S]*start:frontend_readiness[\s\S]*frontend-http-check[\s\S]*stage:frontend_readiness:success[\s\S]*snapshot-saved[\s\S]*result:success:0::1/);
  });
}

test('final publication records frontend HTTP failure without a success snapshot or completed flag', { skip: !bash }, () => {
  const result = runFinalPublicationChecks({ failure: 'frontend-http' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /frontend-http-check[\s\S]*stage:frontend_readiness:failed[\s\S]*result:failed:1:frontend_readiness:0/);
  assert.doesNotMatch(result.stdout, /snapshot-saved|部署完成/);
});

test('final publication accepts requested nginx reload before checking the frontend', { skip: !bash }, () => {
  const result = runFinalPublicationChecks({ reload: '1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /nginx:-s reload/);
  assert.match(result.stdout, /stage:nginx_reload:success[\s\S]*frontend-http-check[\s\S]*snapshot-saved/);
});

for (const failure of ['nginx-config', 'nginx-reload', 'missing-nginx']) {
  test(`final publication rejects requested nginx operation failure: ${failure}`, { skip: !bash }, () => {
    const result = runFinalPublicationChecks({ reload: '1', failure });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /stage:nginx_reload:failed[\s\S]*result:failed:1:nginx_reload:0/);
    assert.doesNotMatch(result.stdout, /frontend-http-check|snapshot-saved|部署完成/);
  });
}

test('frontend HTTP failure in a full deployment records the failed stage and does not commit inputs', { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await enableChangePlanner(fixture);
    const result = runFakeDeployment(bash, fixture, { DEPLOY_CHANGE_PLAN: '1', DEPLOY_TEST_FRONTEND_STATUS: '17' });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /✅ 部署完成/);
    await assert.rejects(readFile(join(fixture.repoDir, '.deploy-cache/deploy-inputs.json')));
    const files = (await readdir(fixture.metricsDir)).filter((name) => name.endsWith('.json'));
    assert.equal(files.length, 1);
    const record = JSON.parse(await readFile(join(fixture.metricsDir, files[0]), 'utf8'));
    assert.equal(record.status, 'failed');
    assert.equal(record.failed_stage, 'frontend_readiness');
    assert.equal(record.stages.find((stage) => stage.name === 'frontend_readiness')?.status, 'failed');
    assert.deepEqual((await readFile(join(fixture.repoDir, '.deploy-cache/frontend-http-call'), 'utf8')).trim().split(/\r?\n/), ['https://public.example.invalid/', bashPath(fixture.webRoot)]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
