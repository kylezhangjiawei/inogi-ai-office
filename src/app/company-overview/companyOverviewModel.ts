import { aggregateProductionTasks, isOverdue, validMonth, type OverviewSources, type ProductionTaskRow } from '../production/overview/overviewModel';
import type { ShipmentState } from '../procurement/shipments/shipmentTypes';
import { getDefectProgress, validateDefectAction } from '../production/defects/defectModel';

export const companyDepartments = ['rd', 'supply', 'production', 'quality'] as const;
export type CompanyDepartment = typeof companyDepartments[number];
export const departmentLabels: Record<CompanyDepartment, string> = { rd: '研发与转产', supply: '供应链交付', production: '生产执行', quality: '质量检验' };
export const companyProducts = ['all', 'IN-100', 'IN-200', 'Q7', 'Q5'] as const;
export type CompanyScenario = 'normal' | 'production-missing' | 'sync-failed' | 'empty';
export interface CompanyContext { month: string; product: string; scope: string }
export interface CompanySources { production: OverviewSources; shipments: ShipmentState; readAt: string }
export interface CompanyEvidence { id: string; title: string; date: string; description: string; href: string }
export interface CompanyMetric { value: number | null; unit: string; source: string; explanation: string; evidence: CompanyEvidence[] }
export interface CompanyIssue extends ProductionTaskRow {
  canonicalKey: string; department: CompanyDepartment; departments: CompanyDepartment[];
  product: string | null; origin: string; evidence: CompanyEvidence[];
}
export interface CompanyIssueFilter { department: string; query: string }
export interface CompanyDraft { context: CompanyContext; issueKey: string; sourceHref: string; body: string }
const businessDate = (at: string) => Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';

export function companyContext(params: URLSearchParams): CompanyContext {
  // Unknown product/scope values remain visible. A URL must never silently widen access or swap products.
  return { month: validMonth(params.get('month') ?? '') ? params.get('month')! : '2026-09', product: params.get('product') || 'all', scope: params.get('scope') || 'all' };
}
export function companyHref(path: string, context: CompanyContext) {
  return `${path}?${new URLSearchParams({ month: context.month, product: context.product, scope: context.scope })}`;
}
export function companyInScope(issue: CompanyIssue, context: CompanyContext) {
  return (context.scope === 'all' || (context.scope === 'owned' && issue.owner === '王晴')) && (context.product === 'all' || issue.product === context.product);
}

/** Canonical source identity is the only deduplication rule, never title, person or department. */
export function deduplicateCompanyIssues(rows: CompanyIssue[]): CompanyIssue[] {
  const unique = new Map<string, CompanyIssue>();
  for (const row of rows) {
    const existing = unique.get(row.canonicalKey);
    if (!existing) { unique.set(row.canonicalKey, { ...row, departments: [...row.departments], evidence: [...row.evidence] }); continue; }
    // The canonical origin retains its current handler/status. Department views only add references.
    unique.set(row.canonicalKey, { ...existing, departments: [...new Set([...existing.departments, ...row.departments])],
      evidence: [...new Map([...existing.evidence, ...row.evidence].map((item) => [item.id, item])).values()] });
  }
  return [...unique.values()];
}

export function projectCompanyIssues(source: OverviewSources): CompanyIssue[] {
  const productByName = new Map(source.planning.products.map((product) => [product.name, product.code]));
  const productByBatch = new Map(source.planning.batches.map((batch) => [batch.code, source.planning.products.find((product) => product.id === batch.productId)?.code ?? null]));
  return deduplicateCompanyIssues(aggregateProductionTasks(source).map((row): CompanyIssue => {
    let department: CompanyDepartment = row.kind === 'inspection' ? 'quality' : row.kind === 'transfer' || row.kind === 'ecn' ? 'rd' : 'production';
    let departments: CompanyDepartment[] = [department];
    let canonicalKey = row.key;
    let product = productByBatch.get(row.batch) ?? null;
    let origin = ({ planning: 'P01 计划原单', inspection: 'P03 检验任务', defect: 'P08 不良原单', transfer: 'P05 转产原单', ecn: 'P10 ECN 待办' })[row.kind];
    const evidence: CompanyEvidence[] = [{ id: row.key, title: row.code, date: row.date, description: row.summary, href: row.href }];
    if (row.kind === 'defect') {
      const issue = source.defects.issues.find((item) => `defect:${item.id}` === row.key);
      if (issue) {
        canonicalKey = `defect-origin:${issue.sourceKey}`;
        product = productByName.get(issue.product) ?? product;
        const progress = getDefectProgress(source.defects, issue.id);
        const closer = source.defects.actors.find((actor) => actor.role === 'quality');
        const activeTechnicalWorkflow = issue.direction === 'rd' && row.href.startsWith('/__preview/production-rd');
        const readyToClose = !activeTechnicalWorkflow && !issue.closedAt && closer && progress.remaining === 0 && progress.ready === 0 && progress.pendingReinspection === 0 && Object.keys(validateDefectAction(source.defects, { kind: 'close', actorId: closer.id, issueId: issue.id, reviewed: true, summary: '只读核对关闭条件' }, issue.date)).length === 0;
        const workflowRole = source.defectWorkflows?.[issue.id] ? source.defects.actors.find((actor) => actor.name === row.owner)?.role : undefined;
        department = readyToClose || issue.closedAt || row.node.includes('技术协同已关闭') ? 'quality' : workflowRole === 'quality' || workflowRole === 'qc' ? 'quality' : workflowRole === 'line' ? 'production' : issue.direction === 'rd' ? 'rd' : issue.direction === 'procurement' ? 'supply' : 'production';
        departments = [...new Set<CompanyDepartment>(['production', 'quality', department, ...(issue.direction === 'rd' ? ['rd' as const] : issue.direction === 'procurement' ? ['supply' as const] : [])])];
        if (readyToClose) {
          const summary = row.node === 'QC 复验通过，待质量关闭' ? row.summary : `${row.summary} 已有 ${progress.resolved} ${issue.unit} QC 合格回执，待质量管理核对并关闭；不改写原责任人。`;
          row = { ...row, owner: closer.name, node: 'QC 复验通过，待质量关闭', href: `/__preview/production-defects?issue=${issue.id}`, risk: '待质量关闭', summary };
          evidence[0] = { ...evidence[0], description: row.summary, href: row.href };
          evidence.push(...source.defects.receipts.filter((receipt) => receipt.issueId === issue.id).map((receipt) => ({ id: `receipt:${receipt.id}`, title: receipt.code, date: receipt.date, description: `${receipt.good} / ${receipt.quantity} ${issue.unit} QC 复验合格 · ${receipt.evidence}`, href: `/__preview/production-defects?issue=${issue.id}&tab=reinspection` })));
        }
        evidence.push({ id: issue.sourceKey, title: issue.sourceCode, date: issue.date, description: `原始不良来源 · ${issue.quantity} ${issue.unit}；${issue.description}`, href: row.href });
        origin = 'P08 原不良 · 协同共用同一事项';
      }
    } else if (row.kind === 'inspection') {
      const task = source.inspections.tasks.find((item) => `inspection:${item.id}` === row.key);
      product = task ? productByName.get(task.product) ?? product : product;
    } else if (row.kind === 'ecn') {
      for (const record of source.ecn.records) {
        const task = record.tasks.find((item) => `ecn:${record.id}:${item.id}` === row.key);
        if (!task) continue;
        const team = source.ecn.actors.find((actor) => actor.id === task.ownerId)?.team;
        department = team === 'purchase' ? 'supply' : team === 'quality' ? 'quality' : team === 'production' ? 'production' : 'rd';
        departments = [...new Set<CompanyDepartment>(['rd', department])];
      }
    } else if (row.kind === 'transfer') departments = ['rd', 'production'];
    return { ...row, canonicalKey, department, departments, product, origin, evidence };
  }));
}

export function selectCompanyIssues(rows: CompanyIssue[], context: CompanyContext, filters: CompanyIssueFilter, today: string) {
  const scoped = deduplicateCompanyIssues(rows).filter((row) => companyInScope(row, context));
  const open = scoped.filter((row) => row.status === 'open');
  const monthRows = open.filter((row) => row.date.slice(0, 7) === context.month);
  const needle = filters.query.trim().toLocaleLowerCase();
  const sort = (a: CompanyIssue, b: CompanyIssue) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.code.localeCompare(b.code);
  return {
    current: monthRows.filter((row) => (filters.department === 'all' || row.departments.includes(filters.department as CompanyDepartment)) && [row.subject, row.code, row.owner, row.batch, row.origin].join(' ').toLocaleLowerCase().includes(needle)).sort(sort),
    carry: open.filter((row) => row.date.slice(0, 7) < context.month || (row.date.slice(0, 7) !== context.month && isOverdue(row, today))).sort(sort),
    monthRows, open,
    // Assign each open record to its current handling department once; collaborative labels are not additive.
    counts: Object.fromEntries(companyDepartments.map((department) => [department, monthRows.filter((row) => row.department === department).length])) as Record<CompanyDepartment, number>,
  };
}

export function companyMetrics(sources: CompanySources, context: CompanyContext, scenario: CompanyScenario = 'normal') {
  const unavailable = (source: string, explanation: string): CompanyMetric => ({ value: null, unit: '台', source, explanation, evidence: [] });
  const restricted = context.scope !== 'all';
  const planningAvailable = scenario !== 'empty' && scenario !== 'production-missing';
  const shipmentsAvailable = scenario !== 'empty';
  const planningProducts = sources.production.planning.products.filter((product) => context.product === 'all' || product.code === context.product);
  const shipmentProducts = sources.shipments.batches.filter((batch) => context.product === 'all' || batch.productCode === context.product);
  const hasPlanningProduct = planningProducts.length > 0;
  const hasShipmentProduct = shipmentProducts.length > 0;
  const missingReason = restricted ? '原凭据未提供当前经办范围的归属，暂不展示全量数值。' : '当前产品在该来源没有已确认映射；不跨产品推算。';
  const completedBatches = sources.production.planning.batches.filter((batch) => planningProducts.some((product) => product.id === batch.productId) && batch.completedDate?.slice(0, 7) === context.month);
  const completionEvidence = completedBatches.map((batch) => ({ id: `completion:${batch.id}`, title: batch.code, date: batch.completedDate!, description: `${batch.completed} 台 · ${batch.completionSource}`, href: `/__preview/production-planning?month=${context.month}&batch=${batch.id}` }));
  const completed: CompanyMetric = !planningAvailable ? unavailable('P01 整机完工', scenario === 'empty' ? '当前演示来源为空。' : '生产来源本次缺失；请更新汇总后重试。') : restricted || !hasPlanningProduct ? unavailable('P01 整机完工', missingReason) : { value: completedBatches.reduce((sum, batch) => sum + batch.completed, 0), unit: '台', source: 'P01 整机完工', explanation: '只计本月整机完工凭据，组件报工不累加。', evidence: completionEvidence };
  const productNames = new Set(planningProducts.map((product) => product.name));
  const finalTaskIds = new Set(sources.production.inspections.tasks.filter((task) => task.stage === 'final' && task.unit === '台' && (context.product === 'all' || productNames.has(task.product))).map((task) => task.id));
  const releases = sources.production.inspections.releases.filter((release) => finalTaskIds.has(release.taskId) && businessDate(release.at).slice(0, 7) === context.month);
  const releaseEvidence = releases.map((release) => ({ id: `release:${release.id}`, title: release.code, date: businessDate(release.at), description: `${release.quantity} 台 · ${release.basis} ${release.note}`, href: `/__preview/production-inspections?task=${release.taskId}&tab=releases` }));
  const released: CompanyMetric = !planningAvailable ? unavailable('P03 QA 授权记录', scenario === 'empty' ? '当前演示来源为空。' : '生产检验来源本次缺失。') : restricted || !hasPlanningProduct ? unavailable('P03 QA 授权记录', missingReason) : { value: releases.reduce((sum, release) => sum + release.quantity, 0), unit: '台', source: 'P03 QA 授权记录', explanation: '仅统计终检整机的本月 QA 放行；QC 合格不能代替授权。', evidence: releaseEvidence };
  const records = sources.shipments.records.filter((record) => shipmentProducts.some((batch) => batch.id === record.batchId) && record.status === 'confirmed' && record.actualDate.slice(0, 7) === context.month);
  const shipmentEvidence = records.map((record) => ({ id: `shipment:${record.id}`, title: record.documentNo, date: record.actualDate, description: `${record.quantity} 台 · ${record.handler} · ${record.note}`, href: `/__preview/shipments?month=${context.month}&selected=${record.id}` }));
  const shipped: CompanyMetric = !shipmentsAvailable ? unavailable('S14 实际出库登记', '当前演示来源为空。') : restricted || !hasShipmentProduct ? unavailable('S14 实际出库登记', missingReason) : { value: records.reduce((sum, record) => sum + record.quantity, 0), unit: '台', source: 'S14 实际出库登记', explanation: '按实际出货日期，仅计已确认；待确认和冲销记录不计入。', evidence: shipmentEvidence };
  const targetValue = sources.shipments.months[context.month]?.target;
  const target: CompanyMetric = !shipmentsAvailable ? unavailable('S14 月度出货目标', '当前演示来源为空。') : restricted || context.product !== 'all' ? unavailable('S14 月度出货目标', restricted ? missingReason : '该目标只提供全部产品口径，未分产品；不分摊。') : targetValue === undefined ? unavailable('S14 月度出货目标', '本月尚无已确认出货目标。') : { value: targetValue, unit: '台', source: 'S14 月度出货目标', explanation: '全部产品出货目标；与 P01 生产计划目标分别维护。', evidence: [{ id: `target:${context.month}`, title: `${context.month} 出货目标`, date: context.month, description: `${targetValue} 台 · 原 S14 月度目标样例，未提供日分解或目标确认时间。`, href: `/__preview/shipments?month=${context.month}` }] };
  const initial = sources.production.inspections.records.filter((record) => finalTaskIds.has(record.taskId) && record.kind === 'initial' && record.date.slice(0, 7) === context.month);
  const inspected = initial.reduce((sum, record) => sum + record.quantity, 0), good = initial.reduce((sum, record) => sum + record.good, 0);
  const firstPassRate = planningAvailable && !restricted && hasPlanningProduct && inspected > 0 ? good / inspected * 100 : null;
  return { completed, released, shipped, target, remaining: target.value !== null && shipped.value !== null ? Math.max(0, target.value - shipped.value) : null,
    firstPassRate, inspected: firstPassRate === null ? null : inspected, good: firstPassRate === null ? null : good,
    qualityEvidence: firstPassRate === null ? [] : initial.map((record) => ({ id: `inspection:${record.id}`, title: record.code, date: record.date, description: `首次 ${record.good} / ${record.quantity} 台合格 · ${record.sipCode} ${record.sipVersion} · ${record.evidence}`, href: `/__preview/production-inspections?task=${record.taskId}&tab=records` })),
  };
}

export function generateCompanyDraft(issue: CompanyIssue, context: CompanyContext, role: string, today: string): CompanyDraft {
  if (role !== 'manager') throw new Error('当前演示岗位仅可查看来源，不能生成催办草稿。');
  if (!companyInScope(issue, context) || issue.status !== 'open') throw new Error('事项已关闭或不在当前查看范围，请重新核对原单。');
  const timing = issue.dueDate ? `原截止日期 ${issue.dueDate}${isOverdue(issue, today) ? '，目前已逾期' : ''}` : '原单尚未确认截止日期，请补充可执行期限';
  return { context: { ...context }, issueKey: issue.canonicalKey, sourceHref: issue.href,
    body: `【本地规则建议 · 未发送】\n请 ${issue.owner} 核对 ${issue.code}「${issue.subject}」。\n当前环节：${issue.node}；${timing}。\n建议：确认当前阻塞、下一步动作和预计完成日期，并在原业务任务更新依据。\n来源：${issue.origin}；${issue.code}；${issue.href}\n来源摘要：${issue.summary}\n查看范围：${context.month} / ${context.product} / ${context.scope}。本草稿不自动更改期限、指派人员或发送通知。` };
}
