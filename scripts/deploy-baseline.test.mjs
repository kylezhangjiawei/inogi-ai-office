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
  "frontend_activate",
  "api_restart",
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
    writeStub(binDir, "npm"),
    writeStub(binDir, "npx"),
    writeStub(binDir, "pm2"),
    writeStub(binDir, "nginx"),
    writeStub(binDir, "node", 'if [ "${1:-}" = "--version" ]; then echo v22.22.1; fi\nexit 0'),
  ]);
  return { root, repoDir, binDir, webRoot, metricsDir };
}

function runFakeDeployment(bash, fixture, overrides = {}) {
  const env = {
    ...process.env,
    PATH: `${bashPath(fixture.binDir)}:/usr/local/bin:/usr/bin:/bin`,
    REPO_DIR: bashPath(fixture.repoDir),
    WEB_ROOT: bashPath(fixture.webRoot),
    DEPLOY_METRICS_DIR: bashPath(fixture.metricsDir),
    DEPLOY_SKIP_GIT: "1",
    DEPLOY_GIT_SHA: "0123456789abcdef0123456789abcdef01234567",
    DEPLOY_DB_BACKUP: "0",
    DEPLOY_RUN_TESTS: "1",
    DEPLOY_OPERATOR: 'qa"\n\u0001operator',
    DATABASE_URL: "postgresql://secret-user:secret-password@secret-host/secret-db",
    ...overrides,
  };
  return spawnSync(bash, [bashPath(deployPath)], {
    cwd: fixture.repoDir,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
}

const bash = await availableBash();

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
