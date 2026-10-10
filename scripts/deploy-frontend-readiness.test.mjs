import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./deploy-frontend-readiness.mjs', import.meta.url));
const html = '<!doctype html><html><head><link rel="stylesheet" href="/assets/app-test.css"><link rel="modulepreload" href="/assets/vendor-test.js"></head><body><div id="root"></div><script type="module" src="/assets/app-test.js"></script></body></html>';
const version = JSON.stringify({ release: 'frontend-only-release', git_sha: 'aaaaaaa' });
const files = new Map([
  ['/', { local: 'index.html', mime: 'text/html; charset=utf-8', body: html }],
  ['/version.json', { local: 'version.json', mime: 'application/json', body: version }],
  ['/assets/app-test.js', { local: 'assets/app-test.js', mime: 'application/javascript', body: 'console.log("application");\n' }],
  ['/assets/vendor-test.js', { local: 'assets/vendor-test.js', mime: 'text/javascript; charset=utf-8', body: 'export const vendor = true;\n' }],
  ['/assets/app-test.css', { local: 'assets/app-test.css', mime: 'text/css', body: 'body { color: #123456; }\n' }],
]);

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'inogi-frontend-readiness-'));
  const webRoot = join(root, 'public static');
  for (const file of files.values()) {
    const target = join(webRoot, file.local);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.body);
  }
  return { root, webRoot };
}

function runCheck(url, webRoot) {
  const env = { ...process.env, EXPECTED_API_SHA: 'bbbbbbb' };
  delete env.NODE_OPTIONS;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, url, webRoot], { env, timeout: 15_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function serve(overrides = new Map()) {
  const requests = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    requests.push({ path, method: req.method });
    const response = overrides.get(path) ?? files.get(path);
    res.writeHead(response?.status ?? (response ? 200 : 404), {
      'content-type': response?.mime ?? 'text/plain',
      ...(response?.headers ?? {}),
    });
    res.end(response?.body ?? 'not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

const failureCases = [
  ['homepage 403', '/', { status: 403, mime: 'text/html', body: '<h1>Forbidden</h1>' }],
  ['homepage redirects', '/', { status: 302, headers: { location: '/redirected' }, body: '' }],
  ['homepage 200 serves a different application', '/', { mime: 'text/html', body: '<!doctype html><html>Old app</html>' }],
  ['homepage has an incorrect MIME type', '/', { ...files.get('/'), mime: 'application/octet-stream' }],
  ['version belongs to an earlier frontend', '/version.json', { mime: 'application/json', body: JSON.stringify({ release: 'old-release', git_sha: 'ccccccc' }) }],
  ['version has an incorrect MIME type', '/version.json', { ...files.get('/version.json'), mime: 'text/html' }],
  ['entry JavaScript is missing', '/assets/app-test.js', { status: 404, body: 'missing' }],
  ['entry JavaScript returns SPA HTML with status 200', '/assets/app-test.js', { mime: 'text/html', body: html }],
  ['entry JavaScript content differs', '/assets/app-test.js', { ...files.get('/assets/app-test.js'), body: 'console.log("old application");\n' }],
  ['entry JavaScript has an incorrect MIME type', '/assets/app-test.js', { ...files.get('/assets/app-test.js'), mime: 'text/plain' }],
  ['modulepreload JavaScript is missing', '/assets/vendor-test.js', { status: 404, body: 'missing' }],
  ['stylesheet content differs', '/assets/app-test.css', { ...files.get('/assets/app-test.css'), body: 'body { color: red; }\n' }],
  ['stylesheet has an incorrect MIME type', '/assets/app-test.css', { ...files.get('/assets/app-test.css'), mime: 'text/plain' }],
];

test('frontend readiness checks real HTTP homepage, version and referenced assets without requesting API', { timeout: 30_000 }, async () => {
  const fixture = await createFixture();
  const server = await serve();
  try {
    const result = await runCheck(server.url, fixture.webRoot);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.deepEqual(new Set(server.requests.map(({ path }) => path)), new Set(files.keys()));
    assert.ok(server.requests.every(({ method }) => method === 'GET'));
  } finally {
    await server.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

for (const [name, path, response] of failureCases) {
  test(`frontend readiness rejects ${name}`, { timeout: 30_000 }, async () => {
    const fixture = await createFixture();
    const server = await serve(new Map([[path, response]]));
    try {
      const result = await runCheck(server.url, fixture.webRoot);
      assert.equal(result.signal, null, result.stderr);
      assert.notEqual(result.code, 0, result.stdout + result.stderr);
      assert.ok(server.requests.some((request) => request.path === path), 'failure must come from the tested HTTP response');
      assert.ok(!server.requests.some((request) => request.path === '/redirected'), 'redirects must not be followed');
    } finally {
      await server.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

for (const invalidVersion of ['not json', '{}', '{"release":"","git_sha":"aaaaaaa"}', '{"release":"release","git_sha":""}']) {
  test(`frontend readiness rejects invalid release metadata ${invalidVersion}`, { timeout: 30_000 }, async () => {
    const fixture = await createFixture();
    const server = await serve(new Map([['/version.json', { mime: 'application/json', body: invalidVersion }]]));
    try {
      // Equal bytes alone are insufficient: the actual published metadata must
      // identify a release, even when the local version file is also malformed.
      await writeFile(join(fixture.webRoot, 'version.json'), invalidVersion);
      const result = await runCheck(server.url, fixture.webRoot);
      assert.equal(result.signal, null, result.stderr);
      assert.notEqual(result.code, 0, result.stdout + result.stderr);
    } finally {
      await server.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test('Linux non-root static server rejects 0700/0600 artifacts and serves the same release after 0755/0644 repair', {
  skip: process.platform !== 'linux' || process.getuid?.() !== 0
    ? 'Requires Linux root to drop the static HTTP server to an unprivileged UID; Windows does not enforce these POSIX modes.'
    : false,
  timeout: 40_000,
}, async () => {
  const fixture = await createFixture();
  const secret = join(fixture.root, 'private.env');
  await writeFile(secret, 'PRIVATE_FIXTURE=1\n', { mode: 0o600 });
  await chmod(fixture.root, 0o755);
  await chmod(fixture.webRoot, 0o700);
  await chmod(join(fixture.webRoot, 'assets'), 0o700);
  for (const file of files.values()) await chmod(join(fixture.webRoot, file.local), 0o600);
  // Start Node before dropping privileges so this also works when the installed
  // executable is in root's private nvm directory. No shell or setuid binary.
  const source = `
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
process.setgroups([]);
process.setgid(65534);
process.setuid(65534);
const files = new Map(${JSON.stringify([...files].map(([path, file]) => [path, { local: file.local, mime: file.mime }]))});
const server = createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  try {
    if (!file) { res.writeHead(404).end('missing'); return; }
    const body = await readFile(join(process.argv[1], file.local));
    res.writeHead(200, { 'content-type': file.mime }).end(body);
  } catch (error) {
    res.writeHead(error.code === 'EACCES' ? 403 : 500).end(error.code);
  }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port, uid: process.getuid() })));
`;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, fixture.webRoot], { env });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout });
  try {
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`unprivileged server startup timed out: ${stderr}`)), 5_000);
      lines.once('line', (line) => { clearTimeout(timeout); resolve(JSON.parse(line)); });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`unprivileged server exited ${code}: ${stderr}`)); });
    });
    assert.equal(ready.uid, 65534, 'the HTTP server must actually run without root privileges');
    const url = `http://127.0.0.1:${ready.port}/`;
    const denied = await fetch(url);
    assert.equal(denied.status, 403);
    assert.equal(await denied.text(), 'EACCES');
    const before = await runCheck(url, fixture.webRoot);
    assert.equal(before.signal, null, before.stderr);
    assert.notEqual(before.code, 0, before.stdout + before.stderr);

    await chmod(fixture.webRoot, 0o755);
    await chmod(join(fixture.webRoot, 'assets'), 0o755);
    for (const file of files.values()) await chmod(join(fixture.webRoot, file.local), 0o644);
    const after = await runCheck(url, fixture.webRoot);
    assert.equal(after.signal, null, after.stderr);
    assert.equal(after.code, 0, after.stdout + after.stderr);
    assert.equal((await stat(secret)).mode & 0o777, 0o600);
    assert.equal(await readFile(secret, 'utf8'), 'PRIVATE_FIXTURE=1\n');
  } finally {
    child.kill('SIGTERM');
    await closed;
    lines.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
