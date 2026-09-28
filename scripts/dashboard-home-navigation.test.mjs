import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const primitive = new Proxy({}, { get: (_, key) => key });
const hasPermission = (permissions, code) => permissions.includes('*') || permissions.includes(code);
const translate = (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key);

function load(path, deps) {
  const source = readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8').replaceAll('import.meta.env.DEV', 'false');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, key => {
    if (key.includes('/components/ui/') || key.includes('/components/horizon/')) return primitive;
    if (key.endsWith('.css')) return {};
    assert.ok(key in deps, `dependency ${key}`);
    return deps[key];
  });
  return exports;
}

function nodes(tree, predicate, output = []) {
  if (!tree || typeof tree !== 'object') return output;
  if (predicate(tree)) output.push(tree);
  React.Children.forEach(tree.props?.children, child => nodes(child, predicate, output));
  for (const key of ['navigation', 'actions', 'trailing', 'meta', 'action']) {
    if (tree.props?.[key]) nodes(tree.props[key], predicate, output);
  }
  return output;
}

function content(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return React.Children.toArray(tree.props?.children).map(content).join('');
}

const riskAccess = load('lib/managementRiskApi.ts', {
  './routePaths': { routePath: (_, fallback) => fallback },
  './purchaseOrderLineNavigation': { buildPurchaseOrderLinePath: () => '' },
});
const model = load('dashboard/managementDashboardModel.ts', {
  '../lib/permissions': { hasPermission },
  '../lib/managementRiskApi': riskAccess,
});

function fixture() {
  let permissions = ['page:production-execution', 'production:view-all'];
  let userId = 'actor';
  let params = new URLSearchParams('month=2026-08');
  function ManagementDashboard() { assert.fail('inactive child inspection must not execute dashboard reads'); }
  const { Dashboard } = load('Dashboard.tsx', {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': primitive,
    recharts: primitive,
    'react-router': {
      Link: 'Link',
      useSearchParams: () => [params, patch => { params = typeof patch === 'function' ? patch(params) : patch; }],
    },
    './auth': { useAuth: () => ({ user: { id: userId, permissions } }) },
    './components/TranslatableText': primitive,
    './components/ui/utils': { cn: (...args) => args.filter(Boolean).join(' ') },
    './lib/dashboardApi': { fetchDashboardData: () => assert.fail('inactive personal dashboard must not fetch') },
    './lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
    './lib/permissions': { hasPermission },
    './dashboard/PersonalOriginalRecords': { PersonalOriginalRecords: 'PersonalOriginalRecords' },
    './dashboard/ManagementDashboard': { ManagementDashboard },
    './dashboard/managementDashboardModel': model,
  });
  return {
    Dashboard,
    ManagementDashboard,
    params: () => new URLSearchParams(params),
    setPermissions(next) { permissions = next; },
    setUserId(next) { userId = next; },
    setSearch(next) { params = new URLSearchParams(next); },
  };
}

test('management is the primary homepage and secondary destinations preserve dashboard context', () => {
  const view = fixture();
  let tree = view.Dashboard();
  assert.equal(tree.type, view.ManagementDashboard);
  assert.equal(nodes(tree, node => node.type === 'Tabs').length, 0);
  assert.equal(nodes(tree.props.navigation, node => node.type === 'DropdownMenuTrigger' && content(node).includes('工作入口')).length, 1);
  const office = nodes(tree.props.navigation, node => node.type === 'DropdownMenuItem' && content(node).includes('我的办公'))[0];
  const tasks = nodes(tree.props.navigation, node => node.type === 'DropdownMenuItem' && content(node).includes('跨岗位待办'))[0];
  assert.ok(office); assert.ok(tasks);

  office.props.onSelect();
  assert.equal(view.params().get('home'), 'office');
  assert.equal(view.params().get('month'), '2026-08');
  view.setSearch('month=2026-08&home=office&homeSection=risks&riskQuality=blocked&riskProduct=product-7&riskPage=3&homeQ=Q7');
  tree = view.Dashboard();
  assert.equal(nodes(tree, node => node.type === view.ManagementDashboard).length, 0);
  assert.equal(nodes(tree, node => node.type?.name === 'PersonalDashboard').length, 1);
  const back = nodes(tree, node => node.type === 'Button' && content(node).includes('返回数据看板'))[0];
  assert.ok(back);
  back.props.onClick();
  assert.equal(view.params().get('home'), 'management');
  assert.equal(view.params().get('month'), '2026-08');
  assert.equal(view.params().get('homeQ'), 'Q7');
  assert.equal(view.params().get('homeSection'), null);
  assert.equal(view.params().get('riskQuality'), null);
  assert.equal(view.params().get('riskProduct'), null);
  assert.equal(view.params().get('riskPage'), null);

  view.setSearch('month=2026-08&home=tasks');
  tree = view.Dashboard();
  assert.equal(nodes(tree, node => node.type === 'PersonalOriginalRecords').length, 1);
  assert.equal(nodes(tree, node => node.type === view.ManagementDashboard).length, 0);
  assert.equal(nodes(tree, node => node.type === 'Button' && content(node).includes('返回数据看板')).length, 1);
  const officeCrosslink = nodes(tree, node => node.type === 'Button' && content(node).trim() === '我的办公')[0];
  assert.ok(officeCrosslink);
  officeCrosslink.props.onClick();
  assert.equal(view.params().get('home'), 'office');
  assert.equal(view.params().get('month'), '2026-08');
});

test('homepage fallback and mounted child identity remain permission scoped', () => {
  const view = fixture();
  view.setPermissions(['page:dashboard']);
  view.setSearch('month=2026-08&home=management');
  let tree = view.Dashboard();
  assert.equal(tree.type.name, 'PersonalDashboard');
  const firstKey = tree.key;

  view.setUserId('other-actor');
  tree = view.Dashboard();
  assert.notEqual(tree.key, firstKey);

  view.setPermissions(['page:production-execution']);
  view.setSearch('month=2026-08&home=tasks');
  tree = view.Dashboard();
  assert.equal(nodes(tree, node => node.type === 'PersonalOriginalRecords').length, 1);
  assert.equal(nodes(tree, node => node.type === 'Button' && content(node).includes('返回数据看板')).length, 0);
  const officeCrosslink = nodes(tree, node => node.type === 'Button' && content(node).trim() === '我的办公')[0];
  assert.ok(officeCrosslink);
});
