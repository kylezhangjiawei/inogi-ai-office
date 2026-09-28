import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/rd/useRdProcurementLinks.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const REFRESH_EVENT = 'inogi:procurement-refreshed';
const task = (rdTaskId, status = 'pending_confirm') => ({ id: `proc-${rdTaskId}`, rdTaskId, status });

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) { const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    emit(name) { for (const listener of listeners.get(name) ?? []) listener(); },
    count() { return [...listeners.values()].reduce((count, set) => count + set.size, 0); },
  };
}

function fixture(t, { ids = ['A'], userId = 'user-1', hidden = false } = {}) {
  const slots = [], effects = [], requests = [], intervals = new Map();
  let cursor = 0, dirty = false, nextTimer = 0, unmounted = false;
  const window = { ...eventTarget(), setInterval: (callback, delay) => { const id = ++nextTimer; intervals.set(id, { callback, delay }); return id; }, clearInterval: id => intervals.delete(id) };
  const document = { ...eventTarget(), visibilityState: hidden ? 'hidden' : 'visible' };
  const changed = (a, b) => !a || a.length !== b.length || b.some((value, i) => !Object.is(a[i], value));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { assert.equal(unmounted, false, 'unmounted hook must not write state'); const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (changed(previous?.deps, deps)) {
        const next = { deps }; slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const dependencies = {
    react: hooks, '../auth': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '../lib/procurementApi': { listRdProcurementLinks: (ids, signal) => new Promise((resolve, reject) => requests.push({ ids, signal, resolve, reject })) },
    '../procurement/data': { PROCUREMENT_REFRESH_EVENT: REFRESH_EVENT },
  };
  const exports = {};
  new Function('exports', 'require', 'window', 'document', code)(exports, id => { assert.ok(id in dependencies, id); return dependencies[id]; }, window, document);
  const view = {
    requests, intervals, window, document, frames: [],
    render() {
      this.frames = [];
      for (let i = 0; i < 20; i++) {
        cursor = 0; dirty = false;
        const value = exports.useRdProcurementLinks(ids); this.frames.push(value);
        while (effects.length) effects.shift()();
        if (!dirty) return value;
      }
      assert.fail('hook did not settle');
    },
    scope(nextIds, nextUser = userId) { ids = nextIds; userId = nextUser; return this.render(); },
    async settle() { await Promise.resolve(); await Promise.resolve(); return this.render(); },
    poll() { for (const { callback } of intervals.values()) callback(); },
    unmount() { if (unmounted) return; for (const slot of slots) slot?.cleanup?.(); unmounted = true; },
  };
  t.after(() => view.unmount());
  view.render();
  return view;
}

test('空范围和未登录不请求，重复乱序可见ID归一后不重读，只返回范围内关联', async (t) => {
  const view = fixture(t, { ids: [] });
  assert.equal(view.requests.length, 0);
  assert.deepEqual(view.render(), { links: {}, loading: false, error: null, refresh: view.render().refresh });
  view.scope(['A'], null); assert.equal(view.requests.length, 0);
  view.scope(['B', '', 'A', 'A'], 'user-1');
  assert.equal(view.requests.length, 1); assert.deepEqual(view.requests[0].ids, ['A', 'B']);
  view.scope(['A', 'B']); assert.equal(view.requests.length, 1);
  view.requests[0].resolve([task('A'), task('outside')]);
  const state = await view.settle();
  assert.deepEqual(Object.keys(state.links), ['A']);
  assert.equal(state.loading, false); assert.equal(state.error, null);
  view.scope([]); assert.equal(view.intervals.size, 0); assert.equal(view.window.count(), 0); assert.equal(view.document.count(), 0);
  view.render().refresh(); assert.equal(view.requests.length, 1);
});

test('范围和账号变化立即隔离状态并取消旧请求，晚到的成功或错误不能覆盖新数据', async (t) => {
  const view = fixture(t);
  const first = view.requests[0];
  view.scope(['B']); assert.equal(first.signal.aborted, true);
  view.requests[1].resolve([task('B', 'testing')]); await view.settle();
  first.resolve([task('A')]);
  assert.deepEqual(Object.keys((await view.settle()).links), ['B']);
  view.scope(['B'], 'user-2');
  assert.deepEqual(view.frames[0].links, {}); assert.equal(view.frames[0].loading, true);
  view.requests[2].resolve([task('B', 'priced')]); await view.settle();
  view.render().refresh(); const previousAccount = view.requests[3];
  view.scope(['B'], 'user-3'); assert.equal(previousAccount.signal.aborted, true);
  previousAccount.reject(new Error('old account failure'));
  const loading = await view.settle(); assert.equal(loading.error, null); assert.deepEqual(loading.links, {});
  view.requests[4].resolve([task('B', 'completed')]);
  assert.equal((await view.settle()).links.B.status, 'completed');
});

test('初次失败明确返回错误，同范围刷新保留关联快照，成功空结果才表示没有关联', async (t) => {
  const view = fixture(t);
  view.requests[0].reject(new Error('无权限读取关联状态'));
  const failed = await view.settle();
  assert.equal(failed.error, '无权限读取关联状态'); assert.equal(failed.loading, false);
  failed.refresh(); view.requests[1].resolve([task('A')]); await view.settle();
  const links = view.render().links;
  view.render().refresh();
  assert.equal(view.render().links, links); assert.equal(view.render().loading, true);
  view.requests[2].reject(new Error('暂时离线'));
  const stale = await view.settle();
  assert.equal(stale.links, links); assert.equal(stale.error, '暂时离线'); assert.equal(stale.loading, false);
  stale.refresh(); view.requests[3].resolve([]);
  const empty = await view.settle(); assert.deepEqual(Object.keys(empty.links), []); assert.equal(empty.error, null);
  for (const reason of [new Error(''), undefined]) {
    const invalidError = fixture(t);
    invalidError.requests[0].reject(reason);
    assert.equal((await invalidError.settle()).error, '采购关联状态加载失败', '异常缺少文案也不能被当作无关联');
  }
});

test('刷新事件合并一次后续读取，focus和60秒轮询无并发，隐藏时停止自动读取并完整清理', async (t) => {
  const view = fixture(t);
  assert.deepEqual([...view.intervals.values()].map(value => value.delay), [60_000]);
  view.window.emit('focus'); view.poll(); assert.equal(view.requests.length, 1);
  view.window.emit(REFRESH_EVENT); view.window.emit(REFRESH_EVENT); view.render().refresh();
  assert.equal(view.requests.length, 1);
  view.requests[0].resolve([task('A')]); await view.settle();
  assert.equal(view.requests.length, 2, '在途期间的写入事件仅补发一次读取');
  view.requests[1].resolve([task('A', 'testing')]); await view.settle();
  view.document.visibilityState = 'hidden';
  view.poll(); view.window.emit('focus'); view.window.emit(REFRESH_EVENT); view.document.emit('visibilitychange');
  assert.equal(view.requests.length, 2);
  view.document.visibilityState = 'visible'; view.document.emit('visibilitychange'); view.window.emit('focus');
  assert.equal(view.requests.length, 3);
  const last = view.requests[2]; const oldRefresh = view.render().refresh;
  view.unmount(); assert.equal(last.signal.aborted, true);
  assert.equal(view.intervals.size, 0); assert.equal(view.window.count(), 0); assert.equal(view.document.count(), 0);
  last.resolve([task('A', 'completed')]); await Promise.resolve(); await Promise.resolve();
  oldRefresh(); assert.equal(view.requests.length, 3);
});
