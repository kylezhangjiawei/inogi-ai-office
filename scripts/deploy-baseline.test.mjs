import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const deploySource = await readFile(new URL("./deploy.sh", import.meta.url), "utf8");
const deployPath = fileURLToPath(new URL("./deploy.sh", import.meta.url));
const plannerSource = await readFile(new URL("./deploy-change-plan.mjs", import.meta.url), "utf8");

const expectedStages = [
  "checkout",
  "dependency_install",
  "frontend_build",
  "prisma_generate",
  "api_build",
  "typecheck",
  "tests",
  "database_backup",
  "database_migration",
  "api_restart",
  "api_readiness",
  "frontend_activate",
  "nginx_reload",
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
  const root = await mkdtemp(join(tmpdir(), "inogi-deploy-baseline-"));
  const repoDir = join(root, "repo");
  const binDir = join(root, "bin");
  const webRoot = join(root, "web");
  const metricsDir = join(root, "metrics");
  await Promise.all([
    mkdir(join(repoDir, "apps", "api"), { recursive: true }),
    mkdir(join(repoDir, "dist"), { recursive: true }),
    mkdir(join(repoDir, "node_modules", ".pnpm"), { recursive: true }),
    mkdir(binDir, { recursive: true }),
    mkdir(webRoot, { recursive: true }),
    mkdir(metricsDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8"),
    writeStub(binDir, "pnpm"),
    writeStub(binDir, "npm"),
    writeStub(binDir, "npx"),
    writeStub(binDir, "pm2", `
if [ "\${1:-}" = "start" ] || [ "\${1:-}" = "restart" ]; then
  printf '{"ok":true,"database":"ready","git_sha":"%s","release":"%s"}\\n' "$APP_GIT_SHA" "$APP_VERSION" > "$REPO_DIR/app-health.json"
fi
exit 0`),
    writeStub(binDir, "curl", 'cat "$REPO_DIR/app-health.json"'),
    writeStub(binDir, "nginx"),
    writeStub(binDir, "node", `if [ "\${1:-}" = "--version" ]; then echo v22.22.1; exit 0; fi
if [ "\${1:-}" = "-e" ]; then exec "${bashPath(process.execPath)}" "$@"; fi
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
    writeFile(join(fixture.repoDir, "src", "App.tsx"), "export const App = 1;\n", "utf8"),
    writeFile(join(fixture.repoDir, "apps", "api", "src", "main.ts"), "export const api = 1;\n", "utf8"),
    writeFile(join(fixture.repoDir, "apps", "api", "prisma", "schema.prisma"), "generator client { provider = \"prisma-client-js\" }\n", "utf8"),
  ]);
  const realNode = bashPath(process.execPath).replaceAll('"', '\\"');
  await writeStub(fixture.binDir, "node", `
case "\${1:-}" in
  *deploy-change-plan.mjs|-e) exec "${realNode}" "$@" ;;
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
    WEB_ROOT: bashPath(fixture.webRoot),
    DEPLOY_METRICS_DIR: bashPath(fixture.metricsDir),
    DEPLOY_SKIP_GIT: "1",
    DEPLOY_GIT_SHA: "0123456789abcdef0123456789abcdef01234567",
    DEPLOY_DB_BACKUP: "0",
    DEPLOY_CHANGE_PLAN: "0",
    DEPLOY_RUN_TESTS: "1",
    DEPLOY_HEALTH_TIMEOUT_SECONDS: "2",
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
    timeout: 30_000,
  });
}

const bash = await availableBash();
const utf8Locale = availableUtf8Locale(bash);

test("failed frozen dependency installation blocks release instead of falling back", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await writeStub(fixture.binDir, "pnpm", `
printf '%s\\n' "$*" >> "$REPO_DIR/install-calls.txt"
case "$*" in *--frozen-lockfile*) exit 42 ;; *) exit 0 ;; esac`);
    const result = runFakeDeployment(bash, fixture);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const calls = (await readFile(join(fixture.repoDir, "install-calls.txt"), "utf8")).trim().split("\n");
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.includes("--frozen-lockfile")));
    await assert.rejects(readFile(join(fixture.repoDir, "app-health.json")));
    await assert.rejects(readFile(join(fixture.webRoot, "version.json")));
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
    await assert.rejects(readFile(join(fixture.repoDir, "app-health.json")));
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
    await assert.rejects(readFile(join(fixture.repoDir, "app-health.json")));
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
    const previousHealth = await readFile(join(fixture.repoDir, "app-health.json"), "utf8");
    await writeFile(join(fixture.repoDir, "apps", "api", "package.json"), '{"dependencies":{"synthetic-package":"2.0.0"}}\n');
    await writeStub(fixture.binDir, "pnpm", `
printf '%s\\n' "$*" >> "$REPO_DIR/install-calls.txt"
exit 42`);
    const second = runFakeDeployment(bash, fixture, { DEPLOY_METRICS_ENABLED: "0" });
    assert.equal(second.status, 1, second.stdout + second.stderr);
    const calls = (await readFile(join(fixture.repoDir, "install-calls.txt"), "utf8")).trim().split("\n");
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.includes("--frozen-lockfile")));
    assert.equal(await readFile(join(fixture.repoDir, "app-health.json"), "utf8"), previousHealth);
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
    assert.equal(JSON.parse(await readFile(join(fixture.repoDir, "app-health.json"), "utf8")).ok, true);
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
      await assert.rejects(readFile(join(fixture.repoDir, "app-health.json")));
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

test("deployment flow wires every baseline stage in order", () => {
  let previousIndex = -1;
  for (const stage of expectedStages) {
    const startPattern = new RegExp(`(?:start_stage|skip_stage) ${stage}\\b`);
    const match = startPattern.exec(deploySource.slice(previousIndex + 1));
    assert.ok(match, `missing deployment stage wiring: ${stage}`);
    previousIndex += match.index + 1;
  }

  assert.match(deploySource, /record_missing_stages/);
  assert.match(deploySource, /record_stage "\$stage_name" skipped/);
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
    assert.equal(record.exit_code, 0);
    assert.equal(record.git_sha, "0123456789abcdef0123456789abcdef01234567");
    assert.equal(record.operator, 'qa"\noperator');
    assert.ok(Number.isFinite(record.duration_ms) && record.duration_ms >= 0);
    assert.deepEqual(record.stages.map((stage) => stage.name), expectedStages);
    assert.equal(record.stages.length, expectedStages.length);
    assert.ok(record.stages.every((stage) => Number.isFinite(stage.duration_ms) && stage.duration_ms >= 0));
    assert.equal(record.stages.find((stage) => stage.name === "database_backup")?.status, "skipped");
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

test("a frontend deployment cannot succeed or save its snapshot without WEB_ROOT", { skip: !bash }, async () => {
  const fixture = await createFakeDeployment();
  try {
    await enableChangePlanner(fixture);
    const result = runFakeDeployment(bash, fixture, {
      DEPLOY_CHANGE_PLAN: "1",
      DEPLOY_METRICS_ENABLED: "0",
      WEB_ROOT: bashPath(join(fixture.root, "missing-web-root")),
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /前端发布目录不存在/);
    await assert.rejects(readFile(join(fixture.repoDir, ".deploy-cache", "deploy-inputs.json")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
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
