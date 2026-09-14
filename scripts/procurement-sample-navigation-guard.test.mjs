import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createMemoryRouter } from 'react-router';
import ts from 'typescript';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('驾驶舱在样品栏目挂载离页保护，列表确认使用单次放行而非删除草稿状态', () => {
  const text = source('src/app/procurement/ProcurementCockpitPage.tsx');
  assert.match(text, /<ProcSampleNavigationGuard/);
  assert.match(text, /approvedSampleNavigationRef\.current = id/);
  assert.doesNotMatch(text, /pendingTab|setPendingTab/);
});

// Use the real data router and guard event handlers. The hook bridge replaces only
// React mounting; routing, blocker transitions and history navigation are not mocked.
function fixture({ dirty = true, busy = false, entries = ['/home', '/proc-cockpit?tab=samples&sample=A'] } = {}) {
  const router = createMemoryRouter([{ path: '*', element: null }], { initialEntries: entries });
  const approvedSampleNavigationRef = { current: null };
  const listeners = new Set(); const slots = []; const effects = [];
  let cursor = 0; let props = { dirty, busy, approvedSampleNavigationRef };
  const hooks = {
    useCallback: (callback) => callback,
    useEffect(callback, deps) {
      const index = cursor++; const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next = { deps }; slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const code = ts.transpileModule(source('src/app/procurement/components/ProcSampleNavigationGuard.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    react: hooks, 'react/jsx-runtime': jsxRuntime,
    'react-router': { useBlocker: (predicate) => router.getBlocker('sample', predicate) },
    '../../components/ui/alert-dialog': new Proxy({}, { get: (_target, key) => key }),
    '../../lib/i18n': { useI18n: () => ({ t: (value) => value }) },
  };
  const exports = {};
  new Function('exports', 'require', 'window', code)(exports, (id) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, {
    addEventListener: (name, handler) => { assert.equal(name, 'beforeunload'); listeners.add(handler); },
    removeEventListener: (name, handler) => { assert.equal(name, 'beforeunload'); listeners.delete(handler); },
  });
  const f = {
    router, approvedSampleNavigationRef, listeners,
    render() {
      cursor = 0;
      const tree = exports.ProcSampleNavigationGuard(props);
      while (effects.length) effects.shift()();
      return tree;
    },
    setProps(next) { props = { ...props, ...next }; this.render(); return this.render(); },
    async navigate(to, options) { await router.navigate(to, options); return this.render(); },
    unload() {
      const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
      for (const listener of listeners) listener(event);
      return event;
    },
    destroy() { for (const slot of slots) slot.cleanup?.(); router.deleteBlocker('sample'); router.dispose(); },
  };
  f.render();
  return f;
}

function find(tree, type) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === type) return tree;
  for (const child of React.Children.toArray(tree.props.children)) {
    const found = find(child, type);
    if (found) return found;
  }
  return null;
}

test('侧栏离开会拦截；取消保留当前样品，确认才进入目标页', async (t) => {
  const f = fixture(); t.after(() => f.destroy());
  let dialog = await f.navigate('/rd-cockpit');
  assert.equal(f.router.state.location.pathname, '/proc-cockpit');
  assert.equal(dialog.props.open, true);
  dialog.props.onOpenChange(false);
  assert.equal(f.render().props.open, false);
  assert.equal(f.router.state.location.search, '?tab=samples&sample=A');
  dialog = await f.navigate('/rd-cockpit');
  let preventedClose = false;
  find(dialog, 'AlertDialogAction').props.onClick({ preventDefault() { preventedClose = true; } });
  await new Promise(setImmediate);
  assert.equal(preventedClose, true, 'Radix close must not reset a navigation that is proceeding');
  assert.equal(f.router.state.location.pathname, '/rd-cockpit');
});

test('离开样品栏目和后退到其他页面均受保护', async (t) => {
  const f = fixture(); t.after(() => f.destroy());
  assert.equal((await f.navigate('/proc-cockpit?tab=stock-plans', { replace: true })).props.open, true);
  assert.equal(f.router.state.location.search, '?tab=samples&sample=A');
  f.render().props.onOpenChange(false);
  assert.equal((await f.navigate(-1)).props.open, true);
  assert.equal(f.router.state.location.pathname, '/proc-cockpit');
  find(f.render(), 'AlertDialogAction').props.onClick({ preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(f.router.state.location.pathname, '/home');
});

test('同栏后退更换样品也拦截；已由列表确认的切换只放行一次', async (t) => {
  const f = fixture({ entries: ['/proc-cockpit?tab=samples&sample=B', '/proc-cockpit?tab=samples&sample=A'] });
  t.after(() => f.destroy());
  assert.equal((await f.navigate(-1)).props.open, true);
  assert.equal(f.router.state.location.search, '?tab=samples&sample=A');
  f.render().props.onOpenChange(false);
  f.approvedSampleNavigationRef.current = 'B';
  assert.equal((await f.navigate('/proc-cockpit?tab=samples&sample=B', { replace: true })).props.open, false);
  assert.equal(f.router.state.location.search, '?tab=samples&sample=B');
  assert.equal(f.approvedSampleNavigationRef.current, null);
  assert.equal((await f.navigate('/proc-cockpit?tab=samples&sample=A')).props.open, true);
});

test('不更换样品的筛选或锚点导航保留表单，无需确认', async (t) => {
  const f = fixture(); t.after(() => f.destroy());
  assert.equal((await f.navigate('/proc-cockpit?tab=samples&sample=A&line=rd#files')).props.open, false);
  assert.equal(f.router.state.location.hash, '#files');
  assert.equal(f.listeners.size, 1, 'safe internal navigation must not release the draft unload protection');
});

test('提交期间不能离开，包括单次已批准的切换；完成后不重放旧导航', async (t) => {
  const f = fixture({ dirty: false, busy: true }); t.after(() => f.destroy());
  f.approvedSampleNavigationRef.current = 'B';
  let dialog = await f.navigate('/proc-cockpit?tab=samples&sample=B');
  assert.equal(dialog.props.open, true);
  assert.equal(find(dialog, 'AlertDialogAction'), null);
  assert.equal(f.router.state.location.search, '?tab=samples&sample=A');
  dialog = f.setProps({ dirty: false, busy: false });
  assert.equal(dialog.props.open, false);
  assert.equal(f.router.state.location.search, '?tab=samples&sample=A');
  assert.equal(f.listeners.size, 0);
  await f.navigate('/rd-cockpit');
  assert.equal(f.router.state.location.pathname, '/rd-cockpit');
});

test('刷新/关闭在脏草稿或提交中触发原生保护，清空草稿和卸载正确清理', (t) => {
  const f = fixture({ dirty: false }); t.after(() => f.destroy());
  assert.equal(f.unload().defaultPrevented, false);
  f.setProps({ dirty: true });
  assert.equal(f.unload().defaultPrevented, true);
  assert.equal(f.unload().returnValue, '');
  f.setProps({ dirty: false, busy: true });
  assert.equal(f.listeners.size, 1);
  assert.equal(f.unload().defaultPrevented, true);
  f.setProps({ dirty: false, busy: false });
  assert.equal(f.listeners.size, 0);
  f.setProps({ dirty: true });
  f.destroy();
  assert.equal(f.listeners.size, 0);
});
