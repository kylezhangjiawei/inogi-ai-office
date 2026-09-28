import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies) {
  const source = readFileSync(new URL(`../src/app/lib/${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, dependency => {
    assert.ok(dependency in dependencies, dependency);
    return dependencies[dependency];
  });
  return exports;
}

const permission = (permissions, code) => permissions.includes('*') || permissions.includes(code);
const { buildVisibleNavigation } = load('useVisibleNavigation.ts', {
  react: {}, '../auth': {}, '../routesConfig': {}, './permissions': { hasPermission: permission }, './permissionCatalogApi': {},
});
const page = code => ({ label: code, path: `/${code}`, requiredPermission: `page:${code}` });
const meta = (code, sortOrder, navHidden = false) => ({ code: `page:${code}`, sortOrder, navHidden, routePath: `/${code}` });

test('catalog order moves registered groups/pages while derived entries keep their slots', () => {
  const groups = [
    { label: 'Supply', items: [page('a'), { label: 'warehouse', requiredPermissionAny: ['page:a'] }, page('b')] },
    { label: 'Knowledge', items: [{ label: 'knowledge', requiredPermissionAny: ['page:kb', 'page:a'] }] },
    { label: 'Research', items: [page('c'), { label: 'translation', requiredPermission: 'i18n:manage' }, page('d')] },
  ];
  const metadata = [meta('kb', -100), meta('detail', -200), meta('a', 40), meta('b', 30), meta('c', 20), meta('d', 10)];
  const before = structuredClone(groups);
  const result = buildVisibleNavigation(groups, ['*'], metadata);
  assert.deepEqual(result.map(group => group.label), ['Research', 'Knowledge', 'Supply']);
  assert.deepEqual(result.map(group => group.items.map(item => item.label)), [['d', 'translation', 'c'], ['knowledge'], ['b', 'warehouse', 'a']]);
  assert.deepEqual(groups, before, 'do not mutate the shared route definitions');
  assert.deepEqual(buildVisibleNavigation(groups, ['*'], []), groups, 'failed/missing metadata keeps the built-in order');
  assert.deepEqual(buildVisibleNavigation(groups, ['*'], [meta('a', 10), meta('b', 10)]), groups, 'equal ranks retain original order');
  assert.deepEqual(buildVisibleNavigation(groups, ['*'], [meta('b', 10), meta('a', 10)])[0].items.map(item => item.label), ['b', 'warehouse', 'a'], 'equal page ranks follow the stable server catalog order, retaining derived slots');
});

test('ordering preserves permission gates, hidden pages and aggregate visibility', () => {
  const groups = [
    { label: 'Supply', items: [page('a'), page('b'), { label: 'warehouse', requiredPermissionAll: ['page:detail'], requiredPermissionAny: ['receive', 'page:a'] }] },
    { label: 'Research', items: [page('c')] },
  ];
  const metadata = [meta('c', 10), meta('b', 20, true), meta('a', 30)];
  assert.deepEqual(buildVisibleNavigation(groups, ['page:a', 'page:b', 'receive'], metadata).map(group => group.items.map(item => item.label)), [['a']]);
  assert.deepEqual(buildVisibleNavigation(groups, ['page:a', 'page:b', 'page:c', 'page:detail', 'receive'], metadata).map(group => group.items.map(item => item.label)), [['c'], ['a', 'warehouse']]);
  assert.deepEqual(buildVisibleNavigation(groups, ['page:b'], metadata), []);
});

test('real catalog groups control navigation order independently of cross-group entries and aggregate aliases', () => {
  const { navGroups } = load('../routesConfig.tsx', {
    'lucide-react': new Proxy({}, { get: (_, key) => key }),
    './lib/routePaths': load('routePaths.ts', {}),
  });
  const { DEFAULT_PERMISSION_CATALOG } = load('../../../apps/api/src/modules/permission-catalog/permission-catalog.defaults.ts', {});
  const metadata = DEFAULT_PERMISSION_CATALOG.filter(item => item.type === 'page');
  const original = buildVisibleNavigation(navGroups, ['*'], metadata);
  const labels = original.map(group => group.label);
  assert.ok(labels.indexOf('研发任务管理') < labels.indexOf('质量与生产'), 'supply-owned warehouse route must not pull the production group ahead of research');
  const catalogLabels = { '知识库': '部门知识库', '人事与行政': '人事行政' };
  const getRank = label => Math.min(...metadata.filter(item => item.groupLabel === `页面访问 · ${catalogLabels[label] ?? label}`).map(item => item.sortOrder));
  assert.deepEqual(labels, [...navGroups].sort((a, b) => getRank(a.label) - getRank(b.label)).map(group => group.label));

  const moved = metadata.map(item => item.groupLabel === '页面访问 · 部门知识库' ? { ...item, sortOrder: item.sortOrder - 1000 } : item);
  const result = buildVisibleNavigation(navGroups, ['*'], moved);
  assert.equal(result[0].label, '知识库', 'moving the department catalog group also moves its aggregate navigation entry');
  assert.deepEqual(result.find(group => group.label === '质量与生产').items.map(item => item.path), original.find(group => group.label === '质量与生产').items.map(item => item.path), 'group ordering does not change membership');

  const mixed = [...metadata, { code: 'production:edit', groupLabel: '页面访问 · 质量与生产', sortOrder: -999 }];
  assert.deepEqual(buildVisibleNavigation(navGroups, ['*'], mixed).map(group => group.label), labels, 'an action item in a mixed catalog group cannot rank the page group');
  const alternateSeparators = metadata.map(item => ({ ...item, groupLabel: item.groupLabel.replace(' · ', ' / ') }));
  assert.deepEqual(buildVisibleNavigation(navGroups, ['*'], alternateSeparators).map(group => group.label), labels);
});

function hookRuntime() {
  let active;
  const react = {
    useState(initial) {
      const target = active;
      const index = target.cursor++;
      if (!(index in target.values)) target.values[index] = typeof initial === 'function' ? initial() : initial;
      return [target.values[index], next => { target.values[index] = typeof next === 'function' ? next(target.values[index]) : next; }];
    },
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const target = active;
      const index = target.cursor++;
      if (!target.deps[index] || deps.some((value, offset) => value !== target.deps[index][offset])) {
        target.cleanups[index]?.();
        target.deps[index] = deps;
        target.pending.push(() => { target.cleanups[index] = fn(); });
      }
    },
  };
  return {
    react,
    mount(read) {
      const target = { cursor: 0, values: [], deps: [], cleanups: [], pending: [] };
      return {
        render() {
          active = target; target.cursor = 0;
          const result = read();
          target.pending.splice(0).forEach(fn => fn());
          return result;
        },
        unmount() { target.cleanups.forEach(fn => fn?.()); },
      };
    },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('successful catalog writes refresh shared navigation immediately; failed writes retain the current snapshot', async () => {
  const runtime = hookRuntime();
  const calls = [];
  const cachedPaths = [];
  let metadata = [meta('a', 10), meta('b', 20)];
  let failWrite = false;
  const { permissionCatalogApi: api, useNavMeta, useNavHiddenCodes } = load('permissionCatalogApi.ts', {
    react: runtime.react,
    './routePaths': { cacheRoutePaths: value => cachedPaths.push(value) },
    './authSession': {
      authFetch: async (path, options) => {
        calls.push({ path, options });
        const read = path.endsWith('/nav-meta');
        return { ok: read || !failWrite, status: failWrite && !read ? 409 : 200, json: async () => read ? metadata : [] };
      },
      readErrorMessage: async () => '保存失败',
    },
  });
  const navigation = runtime.mount(() => useNavMeta('admin'));
  const hidden = runtime.mount(() => useNavHiddenCodes('admin'));
  assert.deepEqual(navigation.render(), []);
  hidden.render();
  await flush();
  assert.deepEqual(navigation.render(), metadata);
  assert.equal(calls.filter(call => call.path.endsWith('/nav-meta')).length, 1);

  failWrite = true;
  await assert.rejects(api.reorderItems(['b', 'a']), /保存失败/);
  assert.deepEqual(navigation.render(), metadata);
  assert.equal(calls.filter(call => call.path.endsWith('/nav-meta')).length, 1);

  failWrite = false;
  metadata = [meta('b', 10, true), meta('a', 20)];
  await api.reorderItems(['b', 'a']);
  await flush();
  assert.deepEqual(navigation.render(), metadata);
  assert.deepEqual([...hidden.render()], ['page:b']);
  assert.equal(calls.filter(call => call.path.endsWith('/nav-meta')).length, 2, 'all subscribers share one refreshed request');
  const reorder = calls.findLast(call => call.path.endsWith('/items/reorder'));
  assert.equal(reorder.options.method, 'POST');
  assert.deepEqual(JSON.parse(reorder.options.body), { ids: ['b', 'a'] });

  await api.saveItem({ id: 'a' });
  await flush();
  await api.deleteItem('a');
  await flush();
  assert.equal(calls.filter(call => call.path.endsWith('/nav-meta')).length, 4);
  assert.deepEqual(cachedPaths.at(-1), metadata);
  navigation.unmount(); hidden.unmount();
});

test('late pre-save requests cannot undo the refreshed order or carry metadata into a different login', async () => {
  const runtime = hookRuntime();
  const reads = [];
  let userId;
  const { permissionCatalogApi: api, useNavMeta } = load('permissionCatalogApi.ts', {
    react: runtime.react,
    './routePaths': { cacheRoutePaths() {} },
    './authSession': {
      authFetch: async path => ({ ok: true, status: 200, json: () => path.endsWith('/nav-meta') ? new Promise(resolve => reads.push(resolve)) : [] }),
      readErrorMessage: async () => '',
    },
  });
  const navigation = runtime.mount(() => useNavMeta(userId));
  assert.deepEqual(navigation.render(), [], 'signed-out navigation has no metadata and does not fetch');
  await flush();
  assert.equal(reads.length, 0);
  userId = 'admin';
  navigation.render(); await flush();
  await api.reorderItems(['b', 'a']); await flush();
  reads[1]([meta('b', 10), meta('a', 20)]); await flush();
  reads[0]([meta('a', 10), meta('b', 20)]); await flush();
  assert.deepEqual(navigation.render().map(item => item.code), ['page:b', 'page:a']);
  userId = 'other';
  assert.deepEqual(navigation.render(), []);
  await flush();
  reads[2]([meta('c', 1)]); await flush();
  assert.deepEqual(navigation.render().map(item => item.code), ['page:c']);
  userId = undefined;
  assert.deepEqual(navigation.render(), []);
  navigation.unmount();
});
