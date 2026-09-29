// Execute compiled JS at the original TS path so fixtures, __dirname and aliases keep working.
const { readFileSync } = require('node:fs');
const { relative, resolve, join, isAbsolute } = require('node:path');
const { createRequire, enableCompileCache } = require('node:module');
const root = process.env.API_TEST_ROOT;
const build = process.env.API_TEST_BUILD_DIR;
if (!root || !build) throw new Error('Use run-tests.cjs to compile the API tests first.');
enableCompileCache(join(build, 'v8'));
const maps = new Map();
createRequire(require.resolve('ts-node'))('@cspotcode/source-map-support').install({
  retrieveSourceMap(source) {
    const map = maps.get(source.replaceAll('\\', '/'));
    return map ? { url: map, map: readFileSync(map, 'utf8') } : null;
  },
});
require.extensions['.ts'] = (module, filename) => {
  const path = relative(root, filename);
  if (path.startsWith('..') || isAbsolute(path)) throw new Error(`Test source outside API project: ${filename}`);
  const compiled = resolve(build, path.replace(/\.ts$/, '.js'));
  maps.set(filename.replaceAll('\\', '/'), `${compiled}.map`);
  const output = readFileSync(compiled, 'utf8');
  module._compile(output, filename);
};
