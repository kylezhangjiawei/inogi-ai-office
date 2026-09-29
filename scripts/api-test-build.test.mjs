import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

test('precompiled API tests preserve source paths, recompile edits and block type errors', async () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const runner = join(repo, 'apps/api/scripts/run-tests.cjs');
  await mkdir(join(repo, '.tmp'), { recursive: true });
  const root = await mkdtemp(join(repo, '.tmp/api-test-build-'));
  const cwd = join(root, 'apps/api');
  const source = join(cwd, 'test/sample.spec.ts');
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const run = (compileOnly = false) => spawnSync(process.execPath, ['-e', `process.exitCode = require(${JSON.stringify(runner)}).runTests({cwd: ${JSON.stringify(cwd)}, compileOnly: ${compileOnly}})`], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000, env: environment,
  });
  try {
    await mkdir(join(cwd, 'test'), { recursive: true });
    await writeFile(join(cwd, 'package.json'), '{"type":"commonjs"}');
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'commonjs', target: 'es2021', skipLibCheck: true, types: ['node'], typeRoots: [join(repo, 'apps/api/node_modules/@types')] },
      include: ['test/*.ts'],
    }));
    const input = value => `import * as assert from 'node:assert/strict';\nconst value: number = ${value};\nassert.equal(value, 7);\nassert.equal(__dirname, ${JSON.stringify(join(cwd, 'test'))});\n`;
    await writeFile(source, input(7));
    let result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(await readFile(join(root, '.deploy-cache/api-test-build/test/sample.spec.js'), 'utf8'), /value = 7/);
    result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // A retained incremental state must not prevent recovery after an output was removed.
    await rm(join(root, '.deploy-cache/api-test-build/test/sample.spec.js'));
    result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await writeFile(source, input(8));
    result = run(true);
    assert.equal(result.status, 0, 'compile-only must typecheck without executing assertions: ' + result.stdout + result.stderr);
    result = run();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /sample\.spec\.ts:3:/);
    await writeFile(source, input('"wrong type"'));
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /TS2322/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
