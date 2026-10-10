import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const models = new Map();
function model(file) {
  if (models.has(file)) return models.get(file);
  const out = {};
  new Function('exports', 'require', compile(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')))(out, dep => model(`app/hr/${dep.slice(2)}.ts`));
  models.set(file, out); return out;
}
const data = model('mocks/hrPreview.ts');
const logic = model('app/hr/hrLogic.ts');
const recruitment = model('app/hr/recruitmentLogic.ts');
const jsx = (type, props, key) => ({ type, props: props || {}, key });
globalThis.requestAnimationFrame = () => 0;
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props.children);
function host(name) {
  let cursor = 0; const values = []; const out = {};
  const deps = {
    react: {
      useRef(initial) { const i=cursor++; values[i] ??= { current: initial }; return values[i]; },
      useState(initial) { const i=cursor++; if (!(i in values)) values[i]=typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i]=typeof next === 'function' ? next(values[i]) : next; }]; },
      useEffect() {}, useId() { return `id-${cursor++}`; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router': { Link: 'a' }, 'lucide-react': {},
    './hrLogic': logic, './recruitmentLogic': recruitment, '../../mocks/hrPreview': data,
  };
  new Function('exports', 'require', compile(readFileSync(new URL('../src/app/hr/WorkViews.tsx', import.meta.url), 'utf8')))(out, dep => {
    if (dep.includes('/components/')) return new Proxy({}, { get: (_, key) => key });
    assert.ok(dep in deps, dep); return deps[dep];
  });
  return { exports: out, render(props) { cursor=0; return out[name](props); } };
}
function fixture() {
  const all=data.createHrState(), module=data.hrModules.find(m=>m.id==='tasks');
  return { module, all, rows:all.tasks, role:'人力负责人', department:'人事行政部', employeeId:'E-001', update() {}, add() { return 'TASK-NEW'; }, notify() {} };
}
const button = (tree, label) => nodes(tree).find(n=>n.type==='Button' && text(n)===label);

test('保存记录表单回传最终编号，新建与编辑均可准确定位', () => {
  for (const isNew of [false, true]) {
    const view=host('RecordForm'), p=fixture(), saved=[];
    const row=p.rows[0];
    const props={p,row:isNew?null:row,onSaved:id=>saved.push(id),onClose(){}};
    if (isNew) {
      const fields={名称:row.title,所属部门:row.dept,负责人:row.owner,'截止／计划日期':row.date,...row.fields};
      for (const [label,value] of Object.entries(fields)) {
        const node=nodes(view.render(props)).find(n=>n.type==='label'&&text(n).startsWith(label));
        const input=nodes(node).find(n=>typeof n.props.onChange==='function');
        input?.props.onChange({target:{value}});
      }
    }
    nodes(view.render(props)).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.deepEqual(saved,[isNew?'TASK-NEW':row.id]);
  }
});

test('共享编辑已保存后重建详情，阻止旧草稿覆盖新内容', () => {
  const view=host('Desk'),p=fixture();
  let tree=view.render({p,children:r=>jsx('detail',{row:r})});
  const before=nodes(tree).find(n=>n.type==='aside').key;
  button(tree,'编辑').props.onClick();
  const editor=nodes(view.render({p})).find(n=>n.type===view.exports.RecordForm);
  assert.equal(typeof editor.props.onSaved,'function');
  editor.props.onSaved(p.rows[0].id);
  assert.notEqual(nodes(view.render({p})).find(n=>n.type==='aside').key,before);
});

test('新建成功后清除不匹配筛选并选中新增记录', () => {
  const view=host('Desk'),p=fixture();
  let tree=view.render({p});
  nodes(tree).find(n=>n.props['aria-label']==='搜索记录').props.onChange({target:{value:'不存在'}});
  button(view.render({p}),'新建').props.onClick();
  const editor=nodes(view.render({p})).find(n=>n.type===view.exports.RecordForm);
  assert.equal(typeof editor.props.onSaved,'function');
  const next={...p.rows[0],id:'TASK-NEW',title:'本次新增'};
  p.rows=[...p.rows,next];
  editor.props.onSaved(next.id);
  tree=view.render({p});
  assert.equal(nodes(tree).find(n=>n.props['aria-label']==='搜索记录').props.value,'');
  assert.match(text(nodes(tree).find(n=>n.type==='aside')),/本次新增/);
});

test('搜索忽略首尾空白，已有结果时仍可清除筛选', () => {
  const view=host('Desk'),p=fixture();
  const tree=view.render({p});
  nodes(tree).find(n=>n.props['aria-label']==='搜索记录').props.onChange({target:{value:`  ${p.rows[0].title}  `}});
  const filtered=view.render({p});
  assert.ok(nodes(filtered).some(n=>n.type==='aside'));
  assert.ok(button(filtered,'清除筛选'));
});

test('有改动的编辑表单关闭前确认，继续编辑保留输入', () => {
  const view=host('RecordForm'),p=fixture();let closed=0;
  const props={p,row:p.rows[0],onClose(){closed++;}};
  const tree=view.render(props);
  nodes(tree).find(n=>n.type==='Input' && n.props.value===p.rows[0].title).props.onChange({target:{value:'修改后尚未保存'}});
  button(view.render(props),'取消').props.onClick();
  assert.equal(closed,0);
  const confirm=nodes(view.render(props)).find(n=>n.type==='AlertDialog');
  assert.equal(confirm?.props.open,true);
  const resume=nodes(view.render(props)).find(n=>n.type==='AlertDialogCancel');
  resume.props.onClick();
  assert.ok(nodes(view.render(props)).some(n=>n.type==='Input'&&n.props.value==='修改后尚未保存'));
  assert.equal(closed,0);
});
