#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { release } from "node:os";
import { fileURLToPath } from "node:url";

const STATE_SCHEMA_VERSION = 1;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const groups = {
  dependencies: [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/api/package.json",
  ],
  frontend: [
    "index.html",
    "postcss.config.mjs",
    "public",
    "src",
    "tsconfig.json",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.ts",
  ],
  api: [
    "apps/api/nest-cli.json",
    "apps/api/src",
    "apps/api/tsconfig.build.json",
    "apps/api/tsconfig.json",
  ],
  prisma: [
    "apps/api/prisma/schema.prisma",
  ],
  migrations: [
    "apps/api/prisma/migrations",
  ],
  quality: [
    "apps/api/scripts",
    "patches",
    "scripts",
  ],
  apiTests: ["apps/api/test"],
  fixtures: [
    ...["direction-a", "direction-b", "direction-c"].flatMap((direction) => [
      `design-prototypes/${direction}/app.js`,
      `design-prototypes/${direction}/styles.css`,
    ]),
    "design-prototypes/direction-d/src",
  ],
  deployment: [
    "deploy/git-hooks/post-receive",
    "deploy/pm2/ecosystem.config.cjs",
    "scripts/deploy-change-plan.mjs",
    "scripts/deploy.sh",
  ],
};

const checkGroups = {
  frontend_type: ["dependencies", "frontend", "quality", "deployment"],
  api_type: ["dependencies", "api", "prisma", "migrations", "quality", "apiTests", "deployment"],
  scripts_tests: Object.keys(groups),
  deploy_tests: ["dependencies", "quality", "deployment"],
  // Frontend-reading contracts live in *.spec.mts; the TS suite covers the backend.
  api_tests: ["dependencies", "api", "prisma", "migrations", "quality", "apiTests", "deployment"],
  api_contracts: ["dependencies", "api", "frontend", "prisma", "migrations", "quality", "apiTests", "deployment"],
  postgres: ["dependencies", "api", "prisma", "migrations", "quality", "apiTests", "deployment"],
};
for (const suite of ["applicant_forms", "audit_receipts", "chat_workspace", "procurement_rollback", "rd_documents"]) {
  checkGroups[`postgres_${suite}`] = checkGroups.postgres;
}

async function sharedConfigurationPaths() {
  const knownPaths = new Set(Object.values(groups).flat());
  const paths = [];
  for (const directory of [".", "apps/api", "apps/api/prisma"]) {
    for (const entry of await readdir(resolve(repoRoot, directory), { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    })) {
      const path = portablePath(relative(repoRoot, resolve(repoRoot, directory, entry.name)));
      if (entry.isDirectory() || knownPaths.has(path)) continue;
      // Include newly introduced shared configuration without collecting logs or generated artifacts.
      if (/\.(?:[cm]?[jt]s|jsonc?|ya?ml|toml|ini|conf|css|lock)$|^\.env(?:\.|$)|rc(?:\.|$)|^\.(?:node-version|tool-versions)$/.test(entry.name)) {
        paths.push(path);
      }
    }
  }
  return paths;
}

function runtimeFingerprint() {
  // Hash application/tool configuration conservatively, excluding only release metadata and session bookkeeping.
  const ignored = /^(?:DEPLOY_|SSH_|XDG_SESSION_)|^(?:APP_VERSION|APP_GIT_SHA|VITE_APP_VERSION|VITE_GIT_SHA|REPO_DIR|WEB_ROOT|PWD|OLDPWD|SHLVL|_|TERM|TERM_PROGRAM|TERM_PROGRAM_VERSION)$/;
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !ignored.test(name))
    .sort(([left], [right]) => left.localeCompare(right, "en")));
  return createHash("sha256").update(JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    os_release: release(),
    versions: process.versions,
    environment,
  })).digest("hex");
}

function postgresVersion() {
  for (const command of ["pg_config", "initdb"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true });
    if (result.status === 0 && result.stdout?.trim()) return [command, result.stdout.trim()];
  }
  return ["unavailable"];
}

function portablePath(path) {
  return path.split(sep).join("/");
}

async function addPath(hash, absolutePath, ancestors = new Set()) {
  const relativePath = portablePath(relative(repoRoot, absolutePath));
  let stat;
  try {
    stat = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      hash.update(`missing\0${relativePath}\0`);
      return;
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    hash.update(`symlink\0${relativePath}\0${await readlink(absolutePath)}\0`);
    await addPath(hash, await realpath(absolutePath), ancestors);
    return;
  }

  if (stat.isDirectory()) {
    const canonicalPath = await realpath(absolutePath);
    if (ancestors.has(canonicalPath)) throw new Error(`cyclic deploy input: ${relativePath}`);
    const descendants = new Set([...ancestors, canonicalPath]);
    hash.update(`directory\0${relativePath}\0`);
    const names = await readdir(absolutePath);
    names.sort((a, b) => a.localeCompare(b, "en"));
    for (const name of names) {
      await addPath(hash, resolve(absolutePath, name), descendants);
    }
    return;
  }

  if (stat.isFile()) {
    hash.update(`file\0${relativePath}\0`);
    hash.update(await readFile(absolutePath));
    hash.update("\0");
    return;
  }

  throw new Error(`unsupported deploy input: ${relativePath}`);
}

async function fingerprint(paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    await addPath(hash, resolve(repoRoot, path));
  }
  return hash.digest("hex");
}

async function createSnapshot() {
  const fingerprints = {};
  for (const [name, paths] of Object.entries(groups)) {
    fingerprints[name] = await fingerprint(name === "quality" ? [...paths, ...await sharedConfigurationPaths()] : paths);
  }
  const runtime = runtimeFingerprint();
  const postgres = postgresVersion();
  const checks = Object.fromEntries(Object.entries(checkGroups).map(([name, inputs]) => [
    name,
    createHash("sha256").update(JSON.stringify([name, runtime, inputs.map((group) => [group, fingerprints[group]]), name.startsWith("postgres") ? postgres : null])).digest("hex"),
  ]));
  return {
    schema_version: STATE_SCHEMA_VERSION,
    fingerprints,
    checks,
  };
}

async function readQualityState(path) {
  if (!path) return null;
  try {
    const value = await readPreviousState(path);
    if (!value?.checks || typeof value.checks !== "object") return null;
    for (const [field, names] of [["fingerprints", Object.keys(groups)], ["checks", Object.keys(value.checks)]]) {
      if (!names.every((name) => typeof value?.[field]?.[name] === "string" && /^[a-f0-9]{64}$/.test(value[field][name]))) return null;
    }
    return value;
  } catch {
    // An unreadable success record is never evidence that a check passed.
    return null;
  }
}

async function readPreviousState(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      value?.schema_version !== STATE_SCHEMA_VERSION ||
      !value.fingerprints ||
      typeof value.fingerprints !== "object"
    ) {
      return null;
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function changed(previous, current, group) {
  return previous?.fingerprints?.[group] !== current.fingerprints[group];
}

const [previousStatePath, candidateStatePath, previousQualityPath] = process.argv.slice(2);
if (!previousStatePath || !candidateStatePath) {
  console.error("usage: deploy-change-plan.mjs <previous-state.json> <candidate-state.json> [previous-quality.json]");
  process.exit(2);
}

const current = await createSnapshot();
const previous = await readPreviousState(previousStatePath);
const previousQuality = await readQualityState(previousQualityPath);
await writeFile(candidateStatePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");

const firstRelease = previous === null;
const deploymentChanged = !firstRelease && changed(previous, current, "deployment");
const forceFull = firstRelease || deploymentChanged;
const dependenciesChanged = forceFull || changed(previous, current, "dependencies");
const prismaChanged = forceFull || dependenciesChanged || changed(previous, current, "prisma");
const frontendChanged = forceFull || dependenciesChanged || changed(previous, current, "frontend");
const apiChanged = forceFull || dependenciesChanged || prismaChanged || changed(previous, current, "api");
const migrationsChanged = forceFull || changed(previous, current, "migrations");
const qualityChanged = forceFull || changed(previous, current, "quality");

const values = {
  DEPLOY_PLAN_REASON: firstRelease
    ? "first-release"
    : deploymentChanged
      ? "deploy-logic-changed"
      : "incremental",
  DEPLOY_PLAN_DEPENDENCIES: Number(dependenciesChanged),
  DEPLOY_PLAN_FRONTEND: Number(frontendChanged),
  DEPLOY_PLAN_API: Number(apiChanged),
  DEPLOY_PLAN_PRISMA: Number(prismaChanged),
  DEPLOY_PLAN_MIGRATIONS: Number(migrationsChanged),
  DEPLOY_PLAN_QUALITY: Number(qualityChanged),
  ...Object.fromEntries(Object.entries({
    FRONTEND_TYPE: "frontend_type", API_TYPE: "api_type", SCRIPTS: "scripts_tests",
    DEPLOY: "deploy_tests", API: "api_tests", API_CONTRACTS: "api_contracts", POSTGRES: "postgres",
    ...Object.fromEntries(Object.keys(checkGroups).filter(name => name.startsWith("postgres_")).map(name => [name.toUpperCase(), name])),
  }).map(([flag, check]) => [`DEPLOY_CHECK_${flag}`, Number(previousQuality?.checks[check] !== current.checks[check])])),
};

for (const [name, value] of Object.entries(values)) {
  process.stdout.write(`${name}=${value}\n`);
}
