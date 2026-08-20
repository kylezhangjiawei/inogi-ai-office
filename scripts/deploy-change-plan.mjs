#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
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
    "apps/api/test",
    "scripts",
  ],
  deployment: [
    "deploy/git-hooks/post-receive",
    "deploy/pm2/ecosystem.config.cjs",
    "scripts/deploy-change-plan.mjs",
    "scripts/deploy.sh",
  ],
};

function portablePath(path) {
  return path.split(sep).join("/");
}

async function addPath(hash, absolutePath) {
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
    return;
  }

  if (stat.isDirectory()) {
    hash.update(`directory\0${relativePath}\0`);
    const names = await readdir(absolutePath);
    names.sort((a, b) => a.localeCompare(b, "en"));
    for (const name of names) {
      await addPath(hash, resolve(absolutePath, name));
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
    fingerprints[name] = await fingerprint(paths);
  }
  return {
    schema_version: STATE_SCHEMA_VERSION,
    fingerprints,
  };
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

const [previousStatePath, candidateStatePath] = process.argv.slice(2);
if (!previousStatePath || !candidateStatePath) {
  console.error("usage: deploy-change-plan.mjs <previous-state.json> <candidate-state.json>");
  process.exit(2);
}

const current = await createSnapshot();
const previous = await readPreviousState(previousStatePath);
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
};

for (const [name, value] of Object.entries(values)) {
  process.stdout.write(`${name}=${value}\n`);
}
