import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function runPlanner(root, previous, candidate) {
  const result = spawnSync(process.execPath, [join(root, "scripts", "deploy-change-plan.mjs"), previous, candidate], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return Object.fromEntries(result.stdout.trim().split(/\r?\n/).map((line) => line.split("=")));
}

test("first release is conservative and a repeated snapshot is a no-op", async () => {
  const root = await createFixture();
  try {
    const state = join(root, "state.json");
    const firstCandidate = join(root, "candidate-1.json");
    const first = runPlanner(root, state, firstCandidate);
    assert.equal(first.DEPLOY_PLAN_REASON, "first-release");
    for (const name of ["FRONTEND", "API", "PRISMA", "MIGRATIONS", "QUALITY"]) {
      assert.equal(first[`DEPLOY_PLAN_${name}`], "1");
    }

    await cp(firstCandidate, state);
    const second = runPlanner(root, state, join(root, "candidate-2.json"));
    assert.equal(second.DEPLOY_PLAN_REASON, "incremental");
    for (const name of ["DEPENDENCIES", "FRONTEND", "API", "PRISMA", "MIGRATIONS", "QUALITY"]) {
      assert.equal(second[`DEPLOY_PLAN_${name}`], "0");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frontend-only, api-only and migration-only changes stay isolated", async () => {
  const root = await createFixture();
  try {
    const state = join(root, "state.json");
    const baseline = join(root, "baseline.json");
    runPlanner(root, state, baseline);
    await cp(baseline, state);

    await writeFile(join(root, "src", "App.tsx"), "export const App = 2;\n", "utf8");
    let plan = runPlanner(root, state, join(root, "frontend.json"));
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "1");
    assert.equal(plan.DEPLOY_PLAN_API, "0");
    assert.equal(plan.DEPLOY_PLAN_MIGRATIONS, "0");

    await writeFile(join(root, "src", "App.tsx"), "export const App = 1;\n", "utf8");
    await writeFile(join(root, "apps", "api", "src", "main.ts"), "export const api = 2;\n", "utf8");
    plan = runPlanner(root, state, join(root, "api.json"));
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "0");
    assert.equal(plan.DEPLOY_PLAN_API, "1");
    assert.equal(plan.DEPLOY_PLAN_PRISMA, "0");

    await writeFile(join(root, "apps", "api", "src", "main.ts"), "export const api = 1;\n", "utf8");
    await writeFile(join(root, "apps", "api", "prisma", "migrations", "001_init", "migration.sql"), "SELECT 2;\n", "utf8");
    plan = runPlanner(root, state, join(root, "migration.json"));
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
    const state = join(root, "state.json");
    const baseline = join(root, "baseline.json");
    runPlanner(root, state, baseline);
    await cp(baseline, state);
    const runner = join(root, "apps", "api", "scripts", "test-chat-workspace-postgres.mjs");
    await writeFile(runner, "export const runner = 2;\n");
    const changed = runPlanner(root, state, join(root, "runner.json"));
    assert.equal(changed.DEPLOY_PLAN_QUALITY, "1");
    for (const scope of ["DEPENDENCIES", "FRONTEND", "API", "PRISMA", "MIGRATIONS"]) {
      assert.equal(changed[`DEPLOY_PLAN_${scope}`], "0");
    }
    await writeFile(runner, "export const runner = 1;\n");
    await writeFile(join(root, "apps", "api", "test-output.log"), "unrelated test output\n");
    const unchanged = runPlanner(root, state, join(root, "unrelated.json"));
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
    const state = join(root, "state.json");
    const baseline = join(root, "baseline.json");
    runPlanner(root, state, baseline);
    await cp(baseline, state);

    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n", "utf8");
    let plan = runPlanner(root, state, join(root, "dependency.json"));
    assert.equal(plan.DEPLOY_PLAN_DEPENDENCIES, "1");
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "1");
    assert.equal(plan.DEPLOY_PLAN_API, "1");
    assert.equal(plan.DEPLOY_PLAN_PRISMA, "1");

    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(join(root, "scripts", "deploy.sh"), "#!/bin/sh\necho changed\n", "utf8");
    plan = runPlanner(root, state, join(root, "deploy.json"));
    assert.equal(plan.DEPLOY_PLAN_REASON, "deploy-logic-changed");
    assert.equal(plan.DEPLOY_PLAN_FRONTEND, "1");
    assert.equal(plan.DEPLOY_PLAN_API, "1");
    assert.equal(plan.DEPLOY_PLAN_MIGRATIONS, "1");
    assert.equal(plan.DEPLOY_PLAN_QUALITY, "1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
