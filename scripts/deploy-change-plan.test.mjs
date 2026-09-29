import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const plannerSource = await readFile(new URL("./deploy-change-plan.mjs", import.meta.url), "utf8");

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "inogi-deploy-plan-"));
  await Promise.all([
    mkdir(join(root, "apps", "api", "prisma", "migrations", "001_init"), { recursive: true }),
    mkdir(join(root, "apps", "api", "src"), { recursive: true }),
    mkdir(join(root, "apps", "api", "test"), { recursive: true }),
    mkdir(join(root, "apps", "api", "scripts"), { recursive: true }),
    mkdir(join(root, "deploy", "git-hooks"), { recursive: true }),
    mkdir(join(root, "deploy", "pm2"), { recursive: true }),
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(root, "src"), { recursive: true }),
    mkdir(join(root, ".deploy-cache"), { recursive: true }),
  ]);

  const files = {
    "package.json": "{}\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "pnpm-workspace.yaml": "packages: []\n",
    "index.html": "<main></main>\n",
    "tsconfig.json": "{}\n",
    "src/App.tsx": "export const App = 1;\n",
    "apps/api/package.json": "{}\n",
    "apps/api/nest-cli.json": "{}\n",
    "apps/api/tsconfig.build.json": "{}\n",
    "apps/api/tsconfig.json": "{}\n",
    "apps/api/src/main.ts": "export const api = 1;\n",
    "apps/api/test/api.spec.ts": "export const testValue = 1;\n",
    "apps/api/scripts/test-chat-workspace-postgres.mjs": "export const runner = 1;\n",
    "apps/api/prisma/schema.prisma": "generator client { provider = \"prisma-client-js\" }\n",
    "apps/api/prisma/migrations/001_init/migration.sql": "SELECT 1;\n",
    "deploy/git-hooks/post-receive": "#!/bin/sh\n",
    "deploy/pm2/ecosystem.config.cjs": "module.exports = {};\n",
    "scripts/deploy.sh": "#!/bin/sh\n",
    "scripts/dev-process-tree.test.mjs": "export {};\n",
    "scripts/dev-runtime.test.mjs": "export {};\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(root, path), content, "utf8");
  }
  await writeFile(join(root, "scripts", "deploy-change-plan.mjs"), plannerSource, "utf8");
  return root;
}

function runPlanner(root, previous, candidate, quality, { env = {}, runtime = "" } = {}) {
  const args = [join(root, "scripts", "deploy-change-plan.mjs"), previous, candidate];
  if (quality) args.push(quality);
  if (runtime) args.unshift("--import", `data:text/javascript,${encodeURIComponent(runtime)}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return Object.fromEntries(result.stdout.trim().split(/\r?\n/).map((line) => line.split("=")));
}

test("first release is conservative and a repeated snapshot is a no-op", async () => {
  const root = await createFixture();
  try {
    const state = join(root, ".deploy-cache", "state.json");
    const firstCandidate = join(root, ".deploy-cache", "candidate-1.json");
    const first = runPlanner(root, state, firstCandidate);
    assert.equal(first.DEPLOY_PLAN_REASON, "first-release");
    for (const name of ["FRONTEND", "API", "PRISMA", "MIGRATIONS", "QUALITY"]) {
      assert.equal(first[`DEPLOY_PLAN_${name}`], "1");
    }

    await cp(firstCandidate, state);
    const second = runPlanner(root, state, join(root, ".deploy-cache", "candidate-2.json"));
    assert.equal(second.DEPLOY_PLAN_REASON, "incremental");
    for (const name of ["DEPENDENCIES", "FRONTEND", "API", "PRISMA", "MIGRATIONS", "QUALITY"]) {
      assert.equal(second[`DEPLOY_PLAN_${name}`], "0");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const checkNames = ["FRONTEND_TYPE", "API_TYPE", "SCRIPTS", "DEPLOY", "API", "POSTGRES"];

test("frontend contracts and PostgreSQL suites have independent retry records", async () => {
  const { root, previous, candidate, quality } = await qualityFixture();
  try {
    const snapshot = JSON.parse(await readFile(candidate, "utf8"));
    assert.ok(snapshot.checks.api_contracts);
    assert.ok(snapshot.checks.postgres_applicant_forms);
    delete snapshot.checks.postgres_rd_documents;
    await writeFile(quality, JSON.stringify(snapshot));
    let plan = runPlanner(root, previous, candidate, quality);
    assert.equal(plan.DEPLOY_CHECK_POSTGRES_APPLICANT_FORMS, "0");
    assert.equal(plan.DEPLOY_CHECK_POSTGRES_RD_DOCUMENTS, "1");
    await writeFile(join(root, 'src/App.tsx'), 'export const App = 3;');
    plan = runPlanner(root, previous, candidate, quality);
    assert.equal(plan.DEPLOY_CHECK_API, "0");
    assert.equal(plan.DEPLOY_CHECK_API_CONTRACTS, "1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a failed later group preserves proof for earlier successful checks", async () => {
  const { root, previous, candidate, quality } = await qualityFixture();
  try {
    const snapshot = JSON.parse(await readFile(candidate, "utf8"));
    snapshot.checks = { frontend_type: snapshot.checks.frontend_type, api_type: snapshot.checks.api_type };
    await writeFile(quality, JSON.stringify(snapshot));
    assertChecks(runPlanner(root, previous, candidate, quality), ["SCRIPTS", "DEPLOY", "API", "POSTGRES"]);
    await writeFile(join(root, "apps/api/src/main.ts"), "export const changed = true;");
    assertChecks(runPlanner(root, previous, candidate, quality), ["API_TYPE", "SCRIPTS", "DEPLOY", "API", "POSTGRES"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function assertChecks(plan, required = checkNames) {
  for (const name of checkNames) {
    assert.equal(plan[`DEPLOY_CHECK_${name}`], required.includes(name) ? "1" : "0", name);
  }
}

async function qualityFixture() {
  const root = await createFixture();
  const previous = join(root, ".deploy-cache", "deploy-inputs.json");
  const candidate = join(root, ".deploy-cache", "candidate.json");
  const quality = join(root, ".deploy-cache", "quality-inputs.json");
  runPlanner(root, previous, candidate);
  await cp(candidate, previous);
  return { root, previous, candidate, quality };
}

test("only a valid separate quality record can reuse successful checks, including a failed deployment retry", async () => {
  const { root, previous, candidate, quality } = await qualityFixture();
  try {
    assertChecks(runPlanner(root, previous, candidate));
    assertChecks(runPlanner(root, previous, candidate, quality));
    // A deployment snapshot (even containing checks) and a generated candidate are not success evidence.
    assertChecks(runPlanner(root, previous, candidate, quality));
    await cp(candidate, quality);
    assertChecks(runPlanner(root, previous, candidate, quality), []);
    await rm(previous);
    const retry = runPlanner(root, previous, candidate, quality);
    assert.equal(retry.DEPLOY_PLAN_REASON, "first-release");
    assertChecks(retry, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("quality checks invalidate only their declared source inputs and test sets", async (t) => {
  const scenarios = [
    ["UI source", "src/App.tsx", ["FRONTEND_TYPE", "SCRIPTS"]],
    ["API source", "apps/api/src/main.ts", ["API_TYPE", "SCRIPTS", "API", "POSTGRES"]],
    ["schema", "apps/api/prisma/schema.prisma", ["API_TYPE", "SCRIPTS", "API", "POSTGRES"]],
    ["migration", "apps/api/prisma/migrations/001_init/migration.sql", ["API_TYPE", "SCRIPTS", "API", "POSTGRES"]],
    ["prototype fixture", "design-prototypes/direction-a/app.js", ["SCRIPTS"]],
    ["new root business test", "scripts/new-business.test.mjs", checkNames],
    ["database runner", "apps/api/scripts/test-chat-workspace-postgres.mjs", checkNames],
    ["API test", "apps/api/test/api.spec.ts", ["API_TYPE", "SCRIPTS", "API", "POSTGRES"]],
    ["lockfile", "pnpm-lock.yaml", checkNames],
    ["package lifecycle", "package.json", checkNames],
    ["deploy implementation", "scripts/deploy.sh", checkNames],
    ["unknown root configuration", "shared.config.mjs", checkNames],
    ["unknown API configuration", "apps/api/prisma.config.ts", checkNames],
    ["npm configuration", ".npmrc", checkNames],
    ["pnpm hook", ".pnpmfile.cjs", checkNames],
    ["dependency patch", "patches/library.patch", checkNames],
    ["API dotenv", "apps/api/.env", checkNames],
    ["Prisma dotenv", "apps/api/prisma/.env", checkNames],
    ["unrelated log", "apps/api/test-output.log", []],
  ];
  for (const [name, path, required] of scenarios) {
    await t.test(name, async () => {
      const { root, previous, candidate, quality } = await qualityFixture();
      try {
        await cp(candidate, quality);
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), "changed test input\n");
        assertChecks(runPlanner(root, previous, candidate, quality), required);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("runtime and environment changes invalidate checks without persisting credentials", async (t) => {
  const scenarios = [
    ["Node version", { runtime: 'Object.defineProperty(process, "version", { value: "v99.0.0" });' }],
    ["architecture", { runtime: 'Object.defineProperty(process, "arch", { value: "fixture-arch" });' }],
    ["platform", { runtime: 'Object.defineProperty(process, "platform", { value: "fixture-os" });' }],
    ["runtime components", { runtime: 'Object.defineProperty(process, "versions", { value: { ...process.versions, v8: "fixture-v8" } });' }],
    ["OS release", { runtime: 'import os from "node:os"; import { syncBuiltinESMExports } from "node:module"; os.release = () => "fixture-kernel"; syncBuiltinESMExports();' }],
    ["Node options", { env: { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --no-warnings`.trim() } }],
    ["application environment", { env: { DATABASE_URL: "postgres://fixture-secret-value" } }],
    ["test database selection", { env: { CHAT_WORKSPACE_TEST_DATABASE_URL: "postgres://fixture-test-database" } }],
  ];
  for (const [name, options] of scenarios) {
    await t.test(name, async () => {
      const { root, previous, candidate, quality } = await qualityFixture();
      try {
        await cp(candidate, quality);
        assertChecks(runPlanner(root, previous, candidate, quality, options));
        const snapshot = await readFile(candidate, "utf8");
        assert.doesNotMatch(snapshot, /fixture-secret-value|fixture-test-database|DATABASE_URL|NODE_OPTIONS|fixture-kernel/);
        await cp(candidate, quality);
        assertChecks(runPlanner(root, previous, candidate, quality, options), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("release metadata changes preserve unrelated checks when a new commit only changes UI", async () => {
  const { root, previous, candidate, quality } = await qualityFixture();
  try {
    runPlanner(root, previous, candidate, quality, { env: { DEPLOY_GIT_SHA: "old-commit", APP_VERSION: "old-release" } });
    await cp(candidate, quality);
    const options = { env: { DEPLOY_GIT_SHA: "new-commit", APP_VERSION: "new-release", DEPLOY_OPERATOR: "operator", DEPLOY_METRICS_DIR: "/new/logs", REPO_DIR: root, WEB_ROOT: "/new/web", SSH_CONNECTION: "new-session" } };
    assertChecks(runPlanner(root, previous, candidate, quality, options), []);
    await writeFile(join(root, "src", "App.tsx"), "export const App = 2;\n");
    assertChecks(runPlanner(root, previous, candidate, quality, options), ["FRONTEND_TYPE", "SCRIPTS"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("system PostgreSQL version changes invalidate its suite even with an unchanged lockfile", async () => {
  const { root, previous, candidate, quality } = await qualityFixture();
  const runtime = (version) => `import childProcess from "node:child_process"; import { syncBuiltinESMExports } from "node:module";
    const original = childProcess.spawnSync;
    childProcess.spawnSync = (command, ...args) => command === "pg_config"
      ? { status: 0, stdout: ${JSON.stringify(version)} } : original(command, ...args);
    syncBuiltinESMExports();`;
  try {
    runPlanner(root, previous, candidate, quality, { runtime: runtime("PostgreSQL 13.22") });
    await cp(candidate, quality);
    assertChecks(runPlanner(root, previous, candidate, quality, { runtime: runtime("PostgreSQL 13.22") }), []);
    assertChecks(runPlanner(root, previous, candidate, quality, { runtime: runtime("PostgreSQL 13.23") }), ["POSTGRES"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("linked source contents are part of quality inputs", async () => {
  const { root, previous, candidate, quality } = await qualityFixture();
  try {
    const target = join(root, "linked-source");
    await mkdir(target);
    await writeFile(join(target, "shared.ts"), "export const shared = 1;\n");
    await symlink(target, join(root, "src", "linked"), "junction");
    runPlanner(root, previous, candidate, quality);
    await cp(candidate, quality);
    assertChecks(runPlanner(root, previous, candidate, quality), []);
    await writeFile(join(target, "shared.ts"), "export const shared = 2;\n");
    assertChecks(runPlanner(root, previous, candidate, quality), ["FRONTEND_TYPE", "SCRIPTS"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed, old or incomplete quality records never skip a check", async (t) => {
  const { root, previous, candidate, quality } = await qualityFixture();
  try {
    const valid = JSON.parse(await readFile(candidate, "utf8"));
    const records = [
      ["invalid JSON", "{"],
      ["null", "null"],
      ["old schema", JSON.stringify({ ...valid, schema_version: 0 })],
      ["missing checks", JSON.stringify({ ...valid, checks: undefined })],
      ["empty checks", JSON.stringify({ ...valid, checks: {} })],
      ["invalid digest", JSON.stringify({ ...valid, checks: { ...valid.checks, frontend_type: "not-sha256" } })],
      ["missing fingerprint", JSON.stringify({ ...valid, fingerprints: {} })],
    ];
    for (const [name, record] of records) {
      await t.test(name, async () => {
        await writeFile(quality, record);
        assertChecks(runPlanner(root, previous, candidate, quality));
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frontend-only, api-only and migration-only changes stay isolated", async () => {
  const root = await createFixture();
  try {
    const state = join(root, ".deploy-cache", "state.json");
    const baseline = join(root, ".deploy-cache", "baseline.json");
    runPlanner(root, state, baseline);
    await cp(baseline, state);

    await writeFile(join(root, "src", "App.tsx"), "export const App = 2;\n", "utf8");
    let plan = runPlanner(root, state, join(root, ".deploy-cache", "frontend.json"));
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "1");
    assert.equal(plan.DEPLOY_PLAN_API, "0");
    assert.equal(plan.DEPLOY_PLAN_MIGRATIONS, "0");

    await writeFile(join(root, "src", "App.tsx"), "export const App = 1;\n", "utf8");
    await writeFile(join(root, "apps", "api", "src", "main.ts"), "export const api = 2;\n", "utf8");
    plan = runPlanner(root, state, join(root, ".deploy-cache", "api.json"));
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "0");
    assert.equal(plan.DEPLOY_PLAN_API, "1");
    assert.equal(plan.DEPLOY_PLAN_PRISMA, "0");

    await writeFile(join(root, "apps", "api", "src", "main.ts"), "export const api = 1;\n", "utf8");
    await writeFile(join(root, "apps", "api", "prisma", "migrations", "001_init", "migration.sql"), "SELECT 2;\n", "utf8");
    plan = runPlanner(root, state, join(root, ".deploy-cache", "migration.json"));
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "0");
    assert.equal(plan.DEPLOY_PLAN_API, "0");
    assert.equal(plan.DEPLOY_PLAN_PRISMA, "0");
    assert.equal(plan.DEPLOY_PLAN_MIGRATIONS, "1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an isolated database runner change triggers quality checks while unrelated files do not", async () => {
  const root = await createFixture();
  try {
    const state = join(root, ".deploy-cache", "state.json");
    const baseline = join(root, ".deploy-cache", "baseline.json");
    runPlanner(root, state, baseline);
    await cp(baseline, state);
    const runner = join(root, "apps", "api", "scripts", "test-chat-workspace-postgres.mjs");
    await writeFile(runner, "export const runner = 2;\n");
    const changed = runPlanner(root, state, join(root, ".deploy-cache", "runner.json"));
    assert.equal(changed.DEPLOY_PLAN_QUALITY, "1");
    for (const scope of ["DEPENDENCIES", "FRONTEND", "API", "PRISMA", "MIGRATIONS"]) {
      assert.equal(changed[`DEPLOY_PLAN_${scope}`], "0");
    }
    await writeFile(runner, "export const runner = 1;\n");
    await writeFile(join(root, "apps", "api", "test-output.log"), "unrelated test output\n");
    const unchanged = runPlanner(root, state, join(root, ".deploy-cache", "unrelated.json"));
    for (const scope of ["DEPENDENCIES", "FRONTEND", "API", "PRISMA", "MIGRATIONS", "QUALITY"]) {
      assert.equal(unchanged[`DEPLOY_PLAN_${scope}`], "0");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency and deploy-logic changes force the safe scopes", async () => {
  const root = await createFixture();
  try {
    const state = join(root, ".deploy-cache", "state.json");
    const baseline = join(root, ".deploy-cache", "baseline.json");
    runPlanner(root, state, baseline);
    await cp(baseline, state);

    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n", "utf8");
    let plan = runPlanner(root, state, join(root, ".deploy-cache", "dependency.json"));
    assert.equal(plan.DEPLOY_PLAN_DEPENDENCIES, "1");
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "1");
    assert.equal(plan.DEPLOY_PLAN_API, "1");
    assert.equal(plan.DEPLOY_PLAN_PRISMA, "1");

    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(join(root, "scripts", "deploy.sh"), "#!/bin/sh\necho changed\n", "utf8");
    plan = runPlanner(root, state, join(root, ".deploy-cache", "deploy.json"));
    assert.equal(plan.DEPLOY_PLAN_REASON, "deploy-logic-changed");
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "1");
    assert.equal(plan.DEPLOY_PLAN_API, "1");
    assert.equal(plan.DEPLOY_PLAN_MIGRATIONS, "1");
    assert.equal(plan.DEPLOY_PLAN_QUALITY, "1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
