import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('backend TS suites keep frontend-reading contracts in the independently triggered MTS group', async () => {
  const directory = new URL('../apps/api/test/', import.meta.url);
  for (const name of await readdir(directory)) {
    if (name.endsWith('.spec.ts')) assert.doesNotMatch(await readFile(new URL(name, directory), 'utf8'), /(?:\.\.\/){3}src\//, name);
  }
});

test('build retry requires matching inputs and complete untampered outputs', async () => {
  const { saveBuild, checkBuild } = await import('./deploy-artifacts.mjs');
  const root = await mkdtemp(join(tmpdir(), 'build-retry-'));
  const context = { root, sha: 'a'.repeat(40), release: 'fixture-release', snapshot: { checks: { frontend_type: 'b'.repeat(64) } } };
  try {
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist/index.html'), 'index');
    await writeFile(join(root, 'dist/chunk.js'), 'chunk');
    assert.equal(await checkBuild(context, 'frontend'), null);
    await saveBuild(context, 'frontend');
    assert.equal((await checkBuild(context, 'frontend')).release, 'fixture-release');
    await writeFile(join(root, 'dist/version.json'), '{"release":"fixture-release"}');
    assert.ok(await checkBuild(context, 'frontend'));
    assert.ok(await checkBuild({ ...context, sha: 'c'.repeat(40) }, 'frontend', true));
    assert.equal(await checkBuild({ ...context, sha: 'c'.repeat(40) }, 'frontend'), null);
    assert.equal(await checkBuild({ ...context, snapshot: { checks: { frontend_type: 'd'.repeat(64) } } }, 'frontend'), null);
    await rm(join(root, 'dist/chunk.js'));
    assert.equal(await checkBuild(context, 'frontend'), null);
    assert.equal(await checkBuild(context, 'frontend', true), null);
    await writeFile(join(root, 'dist/chunk.js'), 'tampered');
    assert.equal(await checkBuild(context, 'frontend'), null);
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(root, 'dist/linked'), 'junction');
    await assert.rejects(saveBuild(context, 'frontend'), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only fully verified artifacts install; source, runtime, bytes and symlinks are checked first', async () => {
  const { createArtifact, verifyArtifact, installArtifact, requiredChecks } = await import('./deploy-artifacts.mjs');
  const root = await mkdtemp(join(tmpdir(), 'release-artifact-'));
  const artifactDir = join(root, 'bundle');
  const snapshot = { fingerprints: { source: 'a'.repeat(64) }, checks: Object.fromEntries(requiredChecks.map(name => [name, 'b'.repeat(64)])) };
  const context = { root, artifactDir, sha: 'a'.repeat(40), release: 'fixture-release', snapshot };
  try {
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'apps/api/dist/src'), { recursive: true });
    await mkdir(join(root, '.deploy-cache'), { recursive: true });
    await writeFile(join(root, 'dist/index.html'), 'verified frontend');
    await writeFile(join(root, 'apps/api/dist/src/main.js'), 'verified backend');
    await assert.rejects(createArtifact(context), /quality/i);
    await writeFile(join(root, '.deploy-cache/quality-inputs.json'), JSON.stringify(snapshot));
    await createArtifact(context);
    await assert.rejects(createArtifact(context), /exist/i);
    await verifyArtifact(context);
    await assert.rejects(verifyArtifact({ ...context, sha: 'c'.repeat(40) }), /commit/i);
    await assert.rejects(verifyArtifact({ ...context, snapshot: { ...snapshot, fingerprints: { source: 'c'.repeat(64) } } }), /inputs/i);
    await writeFile(join(root, 'dist/index.html'), 'old frontend');
    await installArtifact(context);
    assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'verified frontend');
    const manifestPath = join(artifactDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, runtime: { ...manifest.runtime, arch: 'wrong-arch' } }));
    await assert.rejects(verifyArtifact(context), /runtime/i);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(artifactDir, 'dist/index.html'), 'corrupt');
    await writeFile(join(root, 'dist/index.html'), 'keep old frontend');
    await assert.rejects(installArtifact(context), /integrity/i);
    assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'keep old frontend');
  } finally { await rm(root, { recursive: true, force: true }); }
});
