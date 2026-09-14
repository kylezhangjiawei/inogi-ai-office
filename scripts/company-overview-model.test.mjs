import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const base = fileURLToPath(new URL('../src/app/company-overview/', import.meta.url));
const cache = new Map();
const forbid = () => assert.fail('G00 只读投影不得调用接口、消息服务或持久化');
function load(name) {
  const path = resolve(base, name); if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const storage = new Proxy({}, { get: forbid, set: forbid });
  new Function('exports', 'require', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(exports, (child) => { assert.ok(child.startsWith('.'), `只允许已审查的本地读模型依赖 ${child}`); return load(resolve(dirname(path), `${child}.ts`)); }, forbid, storage, storage, storage);
  return exports;
}
const m = load('companyOverviewModel.ts');
const read = load('companyOverviewSources.ts').readCompanySources;
const fresh = () => structuredClone(read());
const context = (patch = {}) => ({ month: '2026-09', product: 'all', scope: 'all', ...patch });
const filters = (patch = {}) => ({ department: 'all', query: '', ...patch });
const today = '2026-09-14';

test('G00 完工、QA 放行、实际出货按各自来源独立统计，不拼成流转台账', () => {
  const source = fresh(), before = structuredClone(source), result = m.companyMetrics(source, context());
  assert.equal(result.completed.value, 216); assert.equal(result.released.value, 100); assert.equal(result.shipped.value, 180);
  assert.equal(result.target.value, 1000); assert.equal(result.remaining, 820);
  assert.equal(source.production.planning.products.reduce((sum, item) => sum + item.monthlyTargets['2026-09'], 0), 1200);
  assert.deepEqual(source, before); assert.equal(result.completed.evidence.length, 2); assert.equal(result.released.evidence.length, 1); assert.equal(result.shipped.evidence.length, 2);
});
test('不把工序报工、终检合格或出货模块的完工摘要累加进整机和授权放行', () => {
  const source = fresh(), before = m.companyMetrics(source, context());
  source.production.planning.tasks.forEach((row) => { row.reported += 10000; row.qualified += 10000; });
  source.shipments.months['2026-09'].completed = 99999;
  source.shipments.batches.forEach((batch) => { batch.releasedQty += 10000; });
  const after = m.companyMetrics(source, context()); assert.equal(after.completed.value, before.completed.value); assert.equal(after.released.value, before.released.value);
});
test('终检首次分母保留单位与月份，复验、过程检不回填首次比例', () => {
  const source = fresh(), before = m.companyMetrics(source, context());
  assert.equal(before.good, 167); assert.equal(before.inspected, 176);
  source.production.inspections.records.push({ ...source.production.inspections.records[0], id: 'extra-retest', kind: 'reinspection', quantity: 1000, good: 1000 });
  source.production.inspections.records.push({ ...source.production.inspections.records[1], id: 'extra-process', quantity: 1000, good: 0 });
  assert.equal(m.companyMetrics(source, context()).firstPassRate, before.firstPassRate);
  assert.equal(m.companyMetrics(source, context({ month: '2026-08' })).firstPassRate, null);
});
test('出货仅累计当月已确认，冲销和待确认不算；QA 用上海业务日期归月', () => {
  const source = fresh(); source.shipments.records[0].status = 'reversed';
  assert.equal(m.companyMetrics(source, context()).shipped.value, 80);
  source.production.inspections.releases.push({ ...source.production.inspections.releases[0], id: 'month-edge', quantity: 5, at: '2026-08-31T17:00:00.000Z' });
  const result = m.companyMetrics(source, context()); assert.equal(result.released.value, 105); assert.equal(result.released.evidence.find((row) => row.id === 'release:month-edge').date, '2026-09-01');
  assert.equal(m.companyMetrics(source, context({ month: '2026-08' })).released.value, 0);
});
test('产品按明确原始编码筛选，不映射 IN 系列与 Q 系列，不分摊全局目标', () => {
  const source = fresh(), q7 = m.companyMetrics(source, context({ product: 'Q7' }));
  for (const key of ['completed', 'released', 'shipped', 'target']) { assert.equal(q7[key].value, null); assert.deepEqual(q7[key].evidence, []); }
  const in100 = m.companyMetrics(source, context({ product: 'IN-100' })); assert.equal(in100.completed.value, 216); assert.equal(in100.shipped.value, 180); assert.equal(in100.target.value, null); assert.equal(in100.remaining, null);
});
test('历史无目标保持缺失，空来源/部分缺失/读取失败保留各自语义', () => {
  const source = fresh(); assert.equal(m.companyMetrics(source, context({ month: '2027-01' })).target.value, null);
  const partial = m.companyMetrics(source, context(), 'production-missing'); assert.equal(partial.completed.value, null); assert.equal(partial.released.value, null); assert.equal(partial.shipped.value, 180); assert.deepEqual(partial.qualityEvidence, []);
  const empty = m.companyMetrics(source, context(), 'empty'); assert.equal(empty.shipped.value, null); assert.equal(empty.target.value, null);
  assert.deepEqual(m.companyMetrics(source, context(), 'sync-failed'), m.companyMetrics(source, context()));
});
test('按原不良来源 key 跨部门去重，相同标题的不同原单保留', () => {
  const source = fresh().production;
  const issue = source.defects.issues[0]; source.defects.issues.push({ ...issue, id: 'another-department-view', code: 'OTHER-VIEW', direction: 'rd' });
  const rows = m.projectCompanyIssues(source), key = `defect-origin:${issue.sourceKey}`;
  assert.equal(rows.filter((row) => row.canonicalKey === key).length, 1);
  assert.ok(rows.find((row) => row.canonicalKey === key).departments.includes('rd'));
  assert.equal(rows.find((row) => row.canonicalKey === key).code, issue.code);
  source.defects.issues.push({ ...issue, id: 'distinct-issue', sourceKey: 'different:source', code: 'DISTINCT' });
  assert.ok(m.projectCompanyIssues(source).some((row) => row.code === 'DISTINCT'));
});
test('P04 技术关闭转 QC 时经办部门归质量，不再按旧研发方向计数', () => {
  const source = fresh().production, issue = source.defects.issues[0]; issue.direction = 'rd';
  source.defectWorkflows = { [issue.id]: { owner: '质量主管', node: '技术协同已关闭，原不良待处理', href: `/__preview/production-defects?issue=${issue.id}`, summary: '技术闭环后原不良仍需 QC 复验' } };
  const row = m.projectCompanyIssues(source).find((item) => item.code === issue.code);
  assert.equal(row.department, 'quality'); assert.equal(row.owner, '质量主管'); assert.equal(row.status, 'open');
  const selected = m.selectCompanyIssues(m.projectCompanyIssues(source), context(), filters(), today);
  assert.equal(Object.values(selected.counts).reduce((sum, n) => sum + n, 0), selected.monthRows.length);
});
test('P08 全部复验合格后投影质量关闭节点，保留原责任人和QC凭据', () => {
  const source = fresh().production, before = structuredClone(source), row = m.projectCompanyIssues(source).find((issue) => issue.code === 'NCR-0907-02');
  assert.equal(row.department, 'quality'); assert.equal(row.owner, '质量管理岗'); assert.equal(row.node, 'QC 复验通过，待质量关闭');
  assert.ok(row.evidence.some((item) => item.title === 'RETEST-0907-02')); assert.deepEqual(source, before);
  const changedReceipt = source.defects.receipts.find((receipt) => receipt.id === 'receipt-verified');
  changedReceipt.good = 5; changedReceipt.bad = 1;
  // The read source now includes derived P00 workflow nodes. Rebuild this changed fixture's
  // projection instead of combining new receipt facts with the previous completed workflow.
  delete source.defectWorkflows['issue-verified'];
  assert.notEqual(m.projectCompanyIssues(source).find((issue) => issue.code === 'NCR-0907-02').node, 'QC 复验通过，待质量关闭');
});
test('研发现场验证阶段依当前验证岗位归生产，仍保留研发参与标签', () => {
  const source = fresh().production, issue = source.defects.issues[0]; issue.direction = 'rd';
  source.defectWorkflows = { [issue.id]: { owner: 'B 线负责人', node: '现场验证中', href: `/__preview/production-rd?issue=${issue.id}`, summary: '待现场验证' } };
  const row = m.projectCompanyIssues(source).find((item) => item.code === issue.code);
  assert.equal(row.department, 'production'); assert.ok(row.departments.includes('rd'));
});
test('QC 回执齐全不覆盖仍在办理的 P04 技术协同当前经办', () => {
  const source = fresh().production, issue = source.defects.issues.find((row) => row.id === 'issue-verified'); issue.direction = 'rd';
  source.defectWorkflows = { [issue.id]: { owner: '研发协同岗', node: '研发处理中', href: `/__preview/production-rd?issue=${issue.id}`, summary: '仍有技术协同待处理' } };
  const row = m.projectCompanyIssues(source).find((item) => item.code === issue.code);
  assert.equal(row.department, 'rd'); assert.equal(row.node, '研发处理中'); assert.equal(row.owner, '研发协同岗'); assert.match(row.href, /production-rd/);
});
test('跨月未完提醒不受搜索和部门过滤隐藏，切历史仍保留外月逾期', () => {
  const rows = m.projectCompanyIssues(fresh().production);
  const result = m.selectCompanyIssues(rows, context(), filters({ department: 'supply', query: '绝无匹配' }), today);
  assert.equal(result.current.length, 0); assert.ok(result.carry.some((row) => row.code === 'TASK-0831-030'));
  const august = m.selectCompanyIssues(rows, context({ month: '2026-08' }), filters(), today);
  assert.ok(august.carry.some((row) => row.code === 'TASK-0911-001')); assert.equal(august.carry.some((row) => row.code === 'TASK-1003-003'), false);
});
test('经办与未知范围不泄露指标、依据或跨月事项', () => {
  const source = fresh(), rows = m.projectCompanyIssues(source.production);
  for (const scope of ['owned', 'unsupported']) {
    const result = m.companyMetrics(source, context({ scope }));
    for (const key of ['completed', 'released', 'shipped', 'target']) { assert.equal(result[key].value, null); assert.deepEqual(result[key].evidence, []); }
    assert.deepEqual(result.qualityEvidence, []); assert.equal(result.firstPassRate, null);
    assert.equal(m.selectCompanyIssues(rows, context({ scope }), filters(), today).open.length, 0);
  }
});
test('深链保留未知产品、月份与范围；不静默映射或放宽', () => {
  const ctx = m.companyContext(new URLSearchParams('month=2026-08&product=IN-unknown&scope=custom-team'));
  assert.equal(ctx.product, 'IN-unknown'); assert.equal(ctx.scope, 'custom-team');
  const href = new URL(m.companyHref('/__preview/key-materials', ctx), 'http://example.test');
  assert.equal(href.searchParams.get('month'), '2026-08'); assert.equal(href.searchParams.get('product'), 'IN-unknown'); assert.equal(href.searchParams.get('scope'), 'custom-team');
});
test('来源建议仅生成本地草稿，保留空期限并拒绝仅查看、越界或关闭事项', () => {
  const source = fresh().production, issue = m.projectCompanyIssues(source).find((row) => row.kind === 'inspection' && row.status === 'open');
  const before = structuredClone(source), draft = m.generateCompanyDraft(issue, context(), 'manager', today);
  assert.match(draft.body, /原单尚未确认截止日期/); assert.ok(draft.body.includes(issue.href)); assert.ok(draft.body.includes(issue.code)); assert.match(draft.body, /未发送/); assert.deepEqual(source, before);
  assert.throws(() => m.generateCompanyDraft(issue, context(), 'viewer', today));
  assert.throws(() => m.generateCompanyDraft(issue, context({ scope: 'owned' }), 'manager', today));
  assert.throws(() => m.generateCompanyDraft({ ...issue, status: 'done' }, context(), 'manager', today));
});
