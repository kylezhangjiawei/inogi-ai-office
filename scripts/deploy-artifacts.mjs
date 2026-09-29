#!/usr/bin/env node
// Local retry records and trusted, verified build directories. No credentials are packaged.
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredChecks = ['frontend_type', 'api_type', 'scripts_tests', 'deploy_tests', 'api_tests', 'api_contracts',
  ...['applicant_forms', 'audit_receipts', 'chat_workspace', 'procurement_rollback', 'rd_documents'].map(s => `postgres_${s}`)];
const outputs = { frontend: 'dist', api: 'apps/api/dist' };
const entries = { frontend: 'dist/index.html', api: 'apps/api/dist/src/main.js' };
const digest = data => createHash('sha256').update(data).digest('hex');
const runtime = () => ({ node: process.version, platform: process.platform, arch: process.arch,
  glibc: process.report?.getReport().header.glibcVersionRuntime ?? null });
const buildEnvironment = () => digest(JSON.stringify(Object.entries(process.env)
  .filter(([key]) => (/^VITE_/.test(key) && !['VITE_APP_VERSION', 'VITE_GIT_SHA'].includes(key)) || key === 'NODE_ENV')
  .sort(([a], [b]) => a.localeCompare(b))));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

async function outputFiles(root, names, ignoreActivationMetadata = false) {
  const files = {};
  async function walk(path) {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Output symlink is forbidden: ${path}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort()) await walk(`${path}/${name}`);
    } else if (stat.isFile()) {
      // Activation writes this metadata after the build; JS still carries the checked release.
      if (!ignoreActivationMetadata || path !== 'dist/version.json') files[path] = digest(await readFile(join(root, path)));
    }
    else throw new Error(`Unsupported output: ${path}`);
  }
  for (const name of names) {
    // Check every ancestor as well as descendants; never follow an output directory link.
    let path = '';
    for (const part of outputs[name].split('/')) {
      path = path ? `${path}/${part}` : part;
      if ((await lstat(join(root, path))).isSymbolicLink()) throw new Error(`Output symlink is forbidden: ${path}`);
    }
    if (!(await readFile(join(root, entries[name]))).length) throw new Error(`Empty output: ${entries[name]}`);
    await walk(outputs[name]);
  }
  return files;
}

function buildKey(context, kind) {
  if (!outputs[kind]) throw new Error('Unknown build kind');
  const check = context.snapshot.checks[`${kind}_type`];
  if (!/^[a-f0-9]{64}$/.test(check ?? '')) throw new Error('Missing build input fingerprint');
  return digest(JSON.stringify([context.sha, check, runtime(), buildEnvironment()]));
}

export async function saveBuild(context, kind) {
  const record = { key: buildKey(context, kind), release: context.release, files: await outputFiles(context.root, [kind], true) };
  const path = join(context.root, '.deploy-cache', `build-${kind}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(record));
  await rename(`${path}.tmp`, path);
}

export async function checkBuild(context, kind, outputsOnly = false) {
  try {
    const record = await readJson(join(context.root, '.deploy-cache', `build-${kind}.json`));
    if ((!outputsOnly && record.key !== buildKey(context, kind)) || !/^[\w.-]+$/.test(record.release)) return null;
    return same(record.files, await outputFiles(context.root, [kind], true)) ? record : null;
  } catch { return null; }
}

export async function createArtifact(context) {
  let quality;
  try { quality = await readJson(join(context.root, '.deploy-cache/quality-inputs.json')); } catch { throw new Error('Missing quality proof'); }
  if (!requiredChecks.every(name => /^[a-f0-9]{64}$/.test(context.snapshot.checks[name] ?? '') && quality.checks?.[name] === context.snapshot.checks[name])) {
    throw new Error('Incomplete quality proof');
  }
  if (!/^[a-f0-9]{40,64}$/.test(context.sha) || !/^[\w.-]+$/.test(context.release)) throw new Error('Invalid release identity');
  const files = await outputFiles(context.root, ['frontend', 'api']);
  // mkdir without recursive intentionally refuses to overwrite an existing release.
  await mkdir(context.artifactDir);
  for (const path of Object.values(outputs)) await cp(join(context.root, path), join(context.artifactDir, path), { recursive: true });
  const manifest = { schema: 1, sha: context.sha, release: context.release, runtime: runtime(), build_environment: buildEnvironment(),
    fingerprints: context.snapshot.fingerprints, checks: Object.fromEntries(requiredChecks.map(name => [name, quality.checks[name]])), files };
  // Write manifest last: interrupted copies are never accepted as complete artifacts.
  await writeFile(join(context.artifactDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await verifyArtifact(context);
  return manifest;
}

export async function verifyArtifact(context) {
  if ((await lstat(context.artifactDir)).isSymbolicLink()) throw new Error('Artifact symlink is forbidden');
  const manifest = await readJson(join(context.artifactDir, 'manifest.json'));
  if (manifest.schema !== 1 || !requiredChecks.every(name => /^[a-f0-9]{64}$/.test(manifest.checks?.[name] ?? ''))) throw new Error('Invalid quality manifest');
  if (manifest.sha !== context.sha || !/^[\w.-]+$/.test(manifest.release)) throw new Error('Artifact commit mismatch');
  if (!same(manifest.fingerprints, context.snapshot.fingerprints) || manifest.build_environment !== buildEnvironment()) throw new Error('Artifact inputs mismatch');
  if (!same(manifest.runtime, runtime())) throw new Error('Artifact runtime mismatch (Node/platform/architecture/libc)');
  if (!same(manifest.files, await outputFiles(context.artifactDir, ['frontend', 'api']))) throw new Error('Artifact integrity failure');
  return manifest;
}

export async function installArtifact(context) {
  const manifest = await verifyArtifact(context);
  // Validate destination ancestors before removing only the two generated output trees.
  for (const path of Object.values(outputs)) {
    let current = context.root;
    for (const part of path.split('/')) {
      current = join(current, part);
      const stat = await lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (stat?.isSymbolicLink()) throw new Error(`Destination symlink is forbidden: ${current}`);
    }
  }
  for (const path of Object.values(outputs)) {
    await rm(join(context.root, path), { recursive: true, force: true });
    await cp(join(context.artifactDir, path), join(context.root, path), { recursive: true });
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, snapshotPath, sha, release, argument] = process.argv.slice(2);
    const context = { root: process.cwd(), snapshot: await readJson(snapshotPath), sha, release, artifactDir: argument ? resolve(argument) : undefined };
    if (command === 'save') await saveBuild(context, argument);
    else if (command === 'check' || command === 'check-output') {
      const record = await checkBuild(context, argument, command === 'check-output');
      if (!record) process.exitCode = 1;
      else console.log(record.release);
    } else if (command === 'pack') await createArtifact(context);
    else if (command === 'verify' || command === 'install') console.log((await (command === 'verify' ? verifyArtifact : installArtifact)(context)).release);
    else throw new Error('Unknown artifact command');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
