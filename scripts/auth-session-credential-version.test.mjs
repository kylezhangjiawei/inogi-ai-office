import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/lib/authSession.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replaceAll('import.meta.env', '{}'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(fetch) {
  const storage = new Map();
  const events = [];
  const window = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    dispatchEvent: event => events.push(event.type),
    setTimeout,
  };
  const auth = {};
  new Function('exports', 'window', 'fetch', compiled)(auth, window, fetch);
  auth.saveAuthSession({ accessToken: 'legacy-access', refreshToken: 'valid-refresh', user: { id: 'alice' } });
  return { auth, storage, events };
}

test('旧版本访问令牌被拒绝后，自动换新并以新令牌重试原写请求一次', async () => {
  const requests = [];
  let writes = 0;
  const h = fixture(async (path, init) => {
    const token = new Headers(init.headers).get('Authorization');
    requests.push({ path, method: init.method ?? 'GET', token, body: init.body });
    if (path === '/api/auth/refresh') {
      assert.deepEqual(JSON.parse(init.body), { refreshToken: 'valid-refresh' });
      return Response.json({ accessToken: 'versioned-access', refreshToken: 'rotated-refresh', user: { id: 'alice' } });
    }
    if (token === 'Bearer legacy-access') return Response.json({ message: '凭据版本已变更' }, { status: 401 });
    assert.equal(token, 'Bearer versioned-access');
    writes++;
    return Response.json({ ok: true });
  });
  const body = JSON.stringify({ value: 'unchanged-request' });
  const response = await h.auth.authFetch('/api/protected-action', { method: 'POST', body });
  assert.equal(response.status, 200);
  assert.deepEqual(requests.map(({ path, method }) => [path, method]), [['/api/protected-action', 'POST'], ['/api/auth/refresh', 'POST'], ['/api/protected-action', 'POST']]);
  assert.equal(requests[0].body, body);
  assert.equal(requests[2].body, body);
  assert.equal(writes, 1);
  assert.equal(h.auth.getAccessToken(), 'versioned-access');
  assert.equal(h.auth.getRefreshToken(), 'rotated-refresh');
  assert.deepEqual(h.events, []);
});

test('改密同时撤销访问和刷新令牌后，清理本地会话且不再次执行原请求', async () => {
  const requests = [];
  const h = fixture(async path => {
    requests.push(path);
    return Response.json({ message: '凭据已失效' }, { status: 401 });
  });
  const response = await h.auth.authFetch('/api/protected-action', { method: 'POST', body: '{}' });
  assert.equal(response.status, 401);
  assert.deepEqual(requests, ['/api/protected-action', '/api/auth/refresh']);
  assert.equal(h.auth.getAccessToken(), null);
  assert.equal(h.auth.getRefreshToken(), null);
  assert.equal(h.auth.getStoredUser(), null);
  assert.deepEqual(h.events, ['inogi-auth-cleared']);
});

test('并发遇到旧版本访问令牌时，只发起一次刷新并分别重试原读取', async () => {
  let refreshes = 0;
  const h = fixture(async (path, init) => {
    if (path === '/api/auth/refresh') {
      refreshes++;
      await new Promise(resolve => setImmediate(resolve));
      return Response.json({ accessToken: 'versioned-access', refreshToken: 'rotated-refresh' });
    }
    const token = new Headers(init.headers).get('Authorization');
    return token === 'Bearer legacy-access' ? new Response(null, { status: 401 }) : Response.json({ path });
  });
  const responses = await Promise.all([h.auth.authFetch('/api/one'), h.auth.authFetch('/api/two')]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(refreshes, 1);
});
