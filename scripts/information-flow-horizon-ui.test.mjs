import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const pages = {
  "售后 Case 列表": source("src/app/AfterSalesList.tsx"),
  "售后 Case 新建": source("src/app/AfterSalesForm.tsx"),
  "售后 Case 详情": source("src/app/AfterSalesDetails.tsx"),
  "研发问题分流": source("src/app/RDIssues.tsx"),
  "注册项目里程碑": source("src/app/RegistrationProjects.tsx"),
  "BOM 确认存档": source("src/app/BOMArchive.tsx"),
  "设计开发变更": source("src/app/DesignChangesPage.tsx"),
};

test("信息流转七个路由页面统一挂载 Horizon 页面骨架", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /className="horizon-theme hz-page/, `${name}应挂载 Horizon 页面作用域`);
    assert.match(page, /<HorizonPageHeader/, `${name}应使用统一 Horizon 页头`);
  }
});

test("售后 Case 覆盖列表、表单和详情的关键交互语义", () => {
  const list = pages["售后 Case 列表"];
  const form = pages["售后 Case 新建"];
  const details = pages["售后 Case 详情"];

  assert.match(list, /<caption className="sr-only">/);
  assert.match(list, /<Dialog open=\{showFilterDialog\}/);
  assert.match(list, /aria-label=\{`查看工单/);
  assert.match(form, /aria-invalid=\{isMissing\("customerName"\)\}/);
  assert.match(form, /role="alert"/);
  assert.match(form, /aria-label=\{`移除附件/);
  assert.match(details, /<AlertDialog open=\{dialogMode === "delete"\}/);
  assert.match(details, /<AlertDialog open=\{Boolean\(statusConfirm\)\}/);
  assert.match(details, /aria-label=\{`复制工单编号/);
});

test("问题分流、注册里程碑和 BOM 存档形成清晰业务工作区", () => {
  const triage = pages["研发问题分流"];
  const registration = pages["注册项目里程碑"];
  const bom = pages["BOM 确认存档"];

  assert.match(triage, /AI 分类置信度/);
  assert.match(triage, /aria-invalid=\{showValidation/);
  assert.match(triage, /<HorizonMetricGrid>/);
  assert.match(registration, /<Dialog open=\{Boolean\(activeReminder\)\}/);
  assert.match(registration, /已完成 \$\{project\.stageIndex \+ 1\} 个阶段/);
  assert.match(bom, /<HorizonMetricGrid>/);
  assert.match(bom, /差异确认|流转就绪度/);
});

test("设计开发变更使用项目 Dialog、语义表格和可访问选择操作", () => {
  const design = pages["设计开发变更"];
  assert.doesNotMatch(design, /@mui\/material/);
  assert.match(design, /<Dialog open=\{dialogMode !== null\}/);
  assert.match(design, /<caption className="sr-only">/);
  assert.match(design, /scope="col"/);
  assert.match(design, /aria-label=\{`\$\{selectedRows\[item\.id\]/);
  assert.match(design, /useDeferredValue\(keyword\)/);
});

test("信息流转页面不包含禁用的视觉与手写弹层模式", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.doesNotMatch(page, /bg-gradient|linear-gradient|radial-gradient/, `${name}不应使用渐变`);
    assert.doesNotMatch(page, /\b(?:indigo|purple|violet)-/, `${name}不应使用旧紫色品牌强调`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name}不应修改字距`);
    assert.doesNotMatch(page, /fixed inset-0/, `${name}不应手写全屏弹层`);
    assert.doesNotMatch(page, /\bh-screen\b/, `${name}不应使用固定屏幕高度`);
  }
});

test("设计变更未开放操作只显示说明，筛选仍可应用且不伪报业务成功", () => {
  const slots = [], messages = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useDeferredValue: value => value, useEffect() {}, useMemo: fn => fn(),
  };
  const code = ts.transpileModule(pages['设计开发变更'], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}, primitives = new Proxy({}, { get: (_, key) => key });
  new Function('require', 'exports', code)(name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsxRuntime : name === 'sonner' ? { toast: { success: message => messages.push(message) } } : name.endsWith('/utils') ? { cn: (...args) => args.filter(Boolean).join(' ') } : primitives, exports);
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children), ...nodes(value.props?.actions)] : [];
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);
  const render = () => { cursor = 0; return exports.DesignChangesPage(); };
  const click = label => { const button = nodes(render()).find(node => node.type === 'Button' && text(node) === label); assert.ok(button, label); button.props.onClick(); };
  assert.match(text(render()), /本页仅供流程预览/);
  for (const label of ['新建变更', '发起评审', '生成影响评估', '导出 DHF 摘要', '安排评审会']) {
    click(label);
    assert.match(text(render()), /此功能尚未开放/);
    click('我知道了');
    assert.equal(nodes(render()).find(node => node.type === 'Dialog').props.open, false);
    assert.deepEqual(messages, []);
  }
  click('筛选');
  nodes(render()).find(node => node.props?.id === 'design-impact-filter').props.onChange({ target: { value: '高' } });
  click('应用筛选');
  assert.deepEqual(messages, ['筛选条件已应用']);
  assert.equal(nodes(render()).filter(node => node.type === 'Button' && node.props['aria-label']?.startsWith('查看 ECO')).length, 2);
});
