import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const t = (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key);
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];

function compileFunction(path, name, bindings) {
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name);
  const defaults = { React: { createElement: jsx }, motion: { div: 'motion.div' }, cn: (...classes) => classes.filter(Boolean).join(' '), t };
  function visit(item) {
    if (ts.isJsxOpeningElement(item) || ts.isJsxSelfClosingElement(item)) {
      const tag = item.tagName.getText(ast);
      if (/^[A-Z]\w*$/.test(tag)) defaults[tag] = tag;
    }
    ts.forEachChild(item, visit);
  }
  visit(node);
  const scope = { ...defaults, ...bindings };
  const code = ts.transpileModule(`${node.getText(ast).replace(/^export /, '')}\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}

test('采购进度入口显示服务端状态，点击只打开采购进度且不触发外层任务', () => {
  const Entry = compileFunction('src/app/rd/RdProcurementProgressEntry.tsx', 'RdProcurementProgressEntry', {
    useI18n: () => ({ t }), PROC_STATUS_META: { partial_arrival: { label: '部分到货', pill: 'partial' } },
  });
  let stopped = false, opened = 0;
  const tree = Entry({ task: { status: 'partial_arrival' }, rdTaskTitle: '气路阀体验证', onOpen: () => { assert.equal(stopped, true); opened++; } });
  const button = nodes(tree).find(node => node.type === 'Button');
  assert.equal(button.props['aria-label'], '查看 气路阀体验证 的采购进度');
  assert.ok(nodes(tree).some(node => node.props?.children?.includes('部分到货')));
  button.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(opened, 1);
  assert.equal(nodes(tree).some(node => node.props?.role === 'progressbar'), false, '采购节点不能冒充完成百分比');
});

test('已关联的研发卡片可直接查看采购，未关联、生产和跨工作区任务不混入', () => {
  const rdTask = { task_id: 'rd-1', title: '气路阀体验证', status: 'in_progress', priority: 'medium', role: 'primary', category_path: '气路 / 阀体', blockers: [], progress: 35, owner: '研发甲' };
  for (const [options, expected] of [
    [{ linked: true }, true], [{ linked: false }, false],
    [{ linked: true, production: true }, false], [{ linked: true, collab: true }, false],
    [{ linked: true, foreign: true }, false], [{ linked: true, status: 'pending_review' }, true],
  ]) {
    const Card = compileFunction('src/app/RDMyWorkspacePage.tsx', 'WorkspaceTaskCard', {
      WS_PRIORITY_CONFIG: { medium: { label: '中', bg: '', text: '' } },
      RD_DEFAULT_SUBPROJECT_LABEL: '默认', isProductionWorkspace: () => !!options.production,
      isUsCollabWorkspace: () => !!options.collab, workspaceDaysUntil: () => null,
      isTaskOverdue: () => false, usePermission: () => false, clampProgressValue: value => value,
    });
    const task = { ...rdTask, status: options.status ?? rdTask.status, ...(options.foreign ? { source_workspace: 'us-collab' } : {}) };
    let opened;
    const entries = nodes(Card({ task, procurementTask: options.linked ? { id: 'proc-1', status: 'in_transit' } : undefined, onOpenProcurement: value => { opened = value; }, onOpen() { assert.fail('应独立打开采购进度'); } }))
      .filter(node => node.type === 'RdProcurementProgressEntry');
    assert.equal(entries.length, Number(expected), JSON.stringify(options));
    if (expected) { entries[0].props.onOpen(); assert.equal(opened, task); }
  }
});
