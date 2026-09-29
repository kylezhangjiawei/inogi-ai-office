const { spawnSync } = require('node:child_process');
const { existsSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');

function runTests({ cwd = resolve(__dirname, '..'), files = ['test/*.spec.ts'], compileOnly = false } = {}) {
  const build = resolve(cwd, '../../.deploy-cache/api-test-build');
  const buildInfo = resolve(build, '.tsbuildinfo');
  // tsc can trust its incremental record even when emitted JS/maps have been removed.
  if (existsSync(buildInfo)) {
    const ts = require('typescript');
    const project = resolve(cwd, 'tsconfig.json');
    const config = ts.readConfigFile(project, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config || {}, ts.sys, cwd, {
      rootDir: cwd, outDir: build, declaration: false, sourceMap: true, noEmit: false,
    }, project);
    if (parsed.fileNames.some(file => ts.getOutputFileNames(parsed, file, !ts.sys.useCaseSensitiveFileNames).some(output => !existsSync(output)))) {
      rmSync(buildInfo);
    }
  }
  const compiled = spawnSync(process.execPath, [
    require.resolve('typescript/bin/tsc'), '-p', resolve(cwd, 'tsconfig.json'),
    '--rootDir', cwd, '--outDir', build, '--tsBuildInfoFile', buildInfo,
    '--declaration', 'false', '--sourceMap', 'true', '--incremental', '--noEmitOnError', '--noEmit', 'false',
  ], { cwd, stdio: 'inherit', windowsHide: true });
  if (compiled.status !== 0) return compiled.status || 1;
  if (compileOnly) return 0;
  const tests = spawnSync(process.execPath, [
    '--enable-source-maps', '--test', '--test-concurrency=2',
    '-r', resolve(__dirname, 'register-test-build.cjs'),
    '-r', require.resolve('tsconfig-paths/register'), ...files,
  ], { cwd, stdio: 'inherit', windowsHide: true, env: { ...process.env, API_TEST_ROOT: cwd, API_TEST_BUILD_DIR: build } });
  return tests.status ?? 1;
}

module.exports = { runTests };
if (require.main === module) process.exitCode = runTests({
  compileOnly: process.argv.includes('--compile-only'),
  files: process.argv.length > 2 && !process.argv.includes('--compile-only') ? process.argv.slice(2) : undefined,
});
