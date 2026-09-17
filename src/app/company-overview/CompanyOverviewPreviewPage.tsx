import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, Building2, ClipboardList, ExternalLink, FileText, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { OrderPageHeader } from '../order-processing/components/HorizonPage';
import { routePath } from '../lib/routePaths';
import { isOverdue, productionToday, shiftMonth, validMonth } from '../production/overview/overviewModel';
import { companyContext, companyDepartments, companyHref, companyMetrics, companyProducts, departmentLabels, generateCompanyDraft, projectCompanyIssues, selectCompanyIssues, type CompanyDraft, type CompanyEvidence, type CompanyIssue, type CompanyMetric, type CompanyScenario } from './companyOverviewModel';
import { readCompanySources } from './companyOverviewSources';
import '../order-processing/horizon.css';
import './company-overview.css';
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Textarea } from "../components/ui/textarea";

const pageSize = 6;
const productLabel = (value: string) => value === 'all' ? '全部产品' : value;
const count = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');
type EvidenceView = { title: string; explanation: string; evidence: CompanyEvidence[] };

function RiskTable({ rows, today, onInspect }: { rows: CompanyIssue[]; today: string; onInspect: (issue: CompanyIssue) => void }) {
  return <div className="co-table-wrap"><table className="co-table"><thead><tr><th>事项与来源</th><th>当前经办 / 环节</th><th>截止时间</th><th>协同范围</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.canonicalKey}>
    <td><Button variant="unstyled" className="co-record" onClick={() => onInspect(row)}>{row.subject}</Button><small>{row.code} · {row.origin}</small><small>{row.batch} · {row.product ?? '产品归属待核对'}</small></td>
    <td><strong>{row.owner}</strong><small>{row.node}</small></td><td><span className={isOverdue(row, today) ? 'co-overdue' : ''}>{row.dueDate ?? '期限待确认'}</span><small>{isOverdue(row, today) ? '已逾期' : row.risk || '原单未标记异常'}</small></td>
    <td>{row.departments.map((department) => <span className="co-tag" key={department}>{departmentLabels[department]}</span>)}</td>
    <td><Link to={row.href}>打开原单<ArrowRight size={13}/></Link></td>
  </tr>)}</tbody></table></div>;
}

export function CompanyOverviewPreviewPage() {
  const [params, setParams] = useSearchParams();
  const context = companyContext(params);
  const [sources, setSources] = useState(readCompanySources);
  const [scenario, setScenario] = useState<CompanyScenario>('normal');
  const [role, setRole] = useState('manager');
  const [department, setDepartment] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [carryOpen, setCarryOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [evidenceView, setEvidenceView] = useState<EvidenceView | null>(null);
  const [draft, setDraft] = useState<CompanyDraft | null>(null);
  const [feedback, setFeedback] = useState('');
  const today = productionToday();
  const rows = scenario === 'empty' || scenario === 'production-missing' ? [] : projectCompanyIssues(sources.production);
  const result = selectCompanyIssues(rows, context, { department, query }, today);
  const metrics = companyMetrics(sources, context, scenario);
  const pages = Math.max(1, Math.ceil(result.current.length / pageSize));
  const activePage = Math.min(page, pages);
  const currentRows = result.current.slice((activePage - 1) * pageSize, activePage * pageSize);
  const selectedIssue = result.open.find((row) => row.canonicalKey === selectedKey) ?? null;
  const lastRead = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sources.readAt));
  const unavailableScope = !['all', 'owned'].includes(context.scope);
  const unrestrictedPreview = context.scope === 'all' && context.product === 'all';
  const sourceMissing = scenario === 'empty' || scenario === 'production-missing';
  const readyHref = companyHref('/__preview/monthly-readiness', context);
  const materialsHref = companyHref('/__preview/key-materials', context);
  const closeViews = () => { setSelectedKey(null); setEvidenceView(null); setDraft(null); };
  const update = (patch: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(patch).forEach(([key, value]) => next.set(key, value)); setParams(next); setPage(1); closeViews(); setFeedback(''); };
  const inspect = (issue: CompanyIssue) => { setSelectedKey(issue.canonicalKey); setEvidenceView(null); setDraft(null); };
  const inspectMetric = (title: string, metric: CompanyMetric) => { setEvidenceView({ title, explanation: `${metric.source} · ${metric.explanation}`, evidence: metric.evidence }); setSelectedKey(null); };
  const refresh = () => { setSources(readCompanySources()); setScenario('normal'); closeViews(); setFeedback('已重新读取本地演示来源；原页面样例分别保留。'); };
  const draftFor = (issue: CompanyIssue) => { try { setDraft(generateCompanyDraft(issue, context, role, today)); setFeedback('已生成来源可追溯的本地草稿，尚未发送。'); } catch (error) { setFeedback(error instanceof Error ? error.message : '草稿未生成，请重新核对来源。'); } };
  const departmentHref = (value: string) => value === 'rd' ? companyHref(routePath('page:rd-task-management', '/rd-task-management'), context) : value === 'supply' ? companyHref(routePath('page:proc-cockpit', '/proc-cockpit'), context) : value === 'production' ? companyHref('/__preview/production-overview', context) : '/__preview/production-inspections';

  return <main className="order-horizon company-overview">
    <OrderPageHeader Icon={Building2} eyebrow="管理层 / G00" title="公司管理总览" description="从交付目标出发，找到需要协调的人和原始任务。" actions={<><Link className="co-secondary" to="/__preview">预览目录</Link><Button variant="unstyled" className="co-primary" onClick={refresh}><RefreshCw size={15}/>更新汇总</Button></>}/>
    <div className="co-demo"><span>前端演示</span><p>汇总现有页面样例。完工、QA 放行和出货分别核对来源；样例尚未构成贯通的业务台账。</p><small>上次本地读取 {lastRead}</small></div>
    <div className="co-toolbar">
      <label>全局月份<Input type="month" aria-label="全局月份" value={context.month} onChange={(event) => { if (validMonth(event.target.value)) update({ month: event.target.value }); }}/></label>
      <div className="co-month-actions"><Button variant="unstyled" aria-label="上个月" onClick={() => update({ month: shiftMonth(context.month, -1) })}>上月</Button><Button variant="unstyled" aria-label="下个月" onClick={() => update({ month: shiftMonth(context.month, 1) })}>下月</Button></div>
      <label>产品<NativeSelect aria-label="产品" value={context.product} onChange={(event) => update({ product: event.target.value })}>{!companyProducts.includes(context.product as typeof companyProducts[number]) ? <option value={context.product}>{context.product} · 待映射</option> : null}{companyProducts.map((product) => <option value={product} key={product}>{productLabel(product)}</option>)}</NativeSelect></label>
      <label>演示查看范围<NativeSelect aria-label="演示查看范围" value={context.scope} onChange={(event) => update({ scope: event.target.value })}>{unavailableScope ? <option value={context.scope}>{context.scope} · 未识别</option> : null}<option value="all">全部可见事项</option><option value="owned">仅王晴经办</option></NativeSelect></label>
      <label>演示岗位<NativeSelect aria-label="演示岗位" value={role} onChange={(event) => { setRole(event.target.value); setDraft(null); }}><option value="manager">管理层</option><option value="viewer">仅查看</option></NativeSelect></label>
      <label>演示来源状态<NativeSelect aria-label="演示来源状态" value={scenario} onChange={(event) => { setScenario(event.target.value as CompanyScenario); closeViews(); setPage(1); setFeedback(''); }}><option value="normal">正常读取</option><option value="production-missing">生产来源缺失</option><option value="sync-failed">本次读取失败</option><option value="empty">空来源</option></NativeSelect></label>
    </div>
    {params.has('month') && !validMonth(params.get('month')!) ? <p className="co-warning" role="alert">入口月份“{params.get('month')}”无效，当前显示 2026-09 演示月份；请重新选择。</p> : null}
    {unavailableScope ? <p className="co-warning" role="alert">入口范围“{context.scope}”尚未识别，相关指标与事项保持隐藏。请核对范围后选择。</p> : null}
    {context.product !== 'all' ? <p className="co-note">当前产品：{context.product}。仅显示来源明确属于该产品的记录；IN 系列与 Q 系列尚无映射，缺失值不推算。</p> : null}
    {scenario === 'sync-failed' ? <div className="co-warning" role="alert"><strong>演示：本次读取失败</strong><span>保留 {lastRead} 上次成功读取的样例。页面数值未因失败清零。</span><Button variant="unstyled" onClick={refresh}>重试读取</Button></div> : null}
    {sourceMissing ? <div className="co-warning" role="alert"><strong>{scenario === 'empty' ? '演示：来源暂无数据' : '演示：生产来源缺失'}</strong><span>{scenario === 'empty' ? '指标显示缺失，不能据此判断没有风险。' : '生产、检验和原任务汇总暂不可用；出货来源单独保留。'}</span><Button variant="unstyled" onClick={refresh}>恢复正常来源</Button></div> : null}
    {feedback ? <p className="co-feedback" role="status">{feedback}</p> : null}

    <section className="co-target" aria-label="月度出货目标">
      <div><span className="co-eyebrow">{context.month} · {productLabel(context.product)}</span><h2>月度出货目标</h2><p>{metrics.target.explanation}</p><Button variant="unstyled" className="co-text-button" onClick={() => inspectMetric('月度出货目标依据', metrics.target)}>核对目标依据<ArrowRight size={13}/></Button></div>
      <dl><div><dt>目标</dt><dd>{count(metrics.target.value)}<small>台</small></dd></div><div><dt>实际出货</dt><dd>{count(metrics.shipped.value)}<small>台</small></dd></div><div><dt>距出货目标</dt><dd>{count(metrics.remaining)}<small>台</small></dd></div></dl>
    </section>

    <section className="co-facts" aria-label="独立业务指标">
      {([{ label: '整机完工', metric: metrics.completed, tone: 'blue' }, { label: 'QA 授权放行', metric: metrics.released, tone: 'green' }, { label: '实际出货', metric: metrics.shipped, tone: 'ink' }] as const).map(({ label, metric, tone }) => <article className="co-fact" key={label} data-tone={tone}><span>{label}</span><strong>{count(metric.value)}<small>台</small></strong><p>{metric.explanation}</p><Button variant="unstyled" className="co-text-button" onClick={() => inspectMetric(`${label}来源依据`, metric)}><FileText size={13}/>{metric.source}<ArrowRight size={13}/></Button></article>)}
    </section>
    <p className="co-note">以上是独立来源的期间汇总，来源批次覆盖不同，不能相减推算在制、待放行或待出货库存。</p>

    <p className="co-note">待办统计范围：P01、P03、P05、P08、P10 演示原单。研发和采购正式待办未读取，以下数量不是部门全部业务量。</p>
    <section className="co-departments" aria-label="部门交付风险入口">{companyDepartments.map((value) => <article key={value} className="co-department"><div className="co-section-heading"><h2>{departmentLabels[value]}</h2><span>{value === 'rd' ? 'R00' : value === 'supply' ? 'S00' : value === 'production' ? 'P00' : 'P03'}</span></div><Button variant="unstyled" className="co-count-filter" onClick={() => { setDepartment(value); setQuery(''); setPage(1); }}><strong>{sourceMissing || unavailableScope ? '—' : result.counts[value]}</strong><span>项本月经办待办<ArrowRight size={13}/></span></Button><p>按当前经办部门归属；协同事项只计一次。</p>{(value === 'production' || value === 'quality') && !unrestrictedPreview ? <small>原入口暂不支持当前产品 / 经办范围，请在全部产品和范围下进入。</small> : <Link to={departmentHref(value)}>进入{departmentLabels[value]}<ArrowRight size={13}/></Link>}{value === 'rd' || value === 'supply' ? <small>正式入口，需要正常登录与页面权限</small> : <small>开发预览，来源尚未接通正式业务</small>}</article>)}</section>

    <div className="co-insights"><section className="co-panel co-readiness"><div className="co-section-heading"><h2>供应链齐套与关键物件</h2><span>S15 / S18</span></div><p>按产品核对本月需求、当前合格可用量和历史预测。Q7 / Q5 月度齐套样例与 IN 系列生产样例分别维护。</p><div className="co-linked-actions"><Link className="co-primary" to={readyHref}>月度齐套与历史预测<ArrowRight size={14}/></Link><Link className="co-secondary" to={materialsHref}>全部关键物件<ArrowRight size={14}/></Link></div><small>沿用 {context.month} / {productLabel(context.product)} / {context.scope === 'all' ? '全部可见范围' : context.scope === 'owned' ? '王晴经办范围' : context.scope}。无需求物件可在全量目录查看。</small></section>
      <section className="co-panel"><div className="co-section-heading"><h2>终检首次合格率</h2><ShieldCheck size={17}/></div><strong className="co-quality-number">{metrics.firstPassRate === null ? '—' : `${metrics.firstPassRate.toFixed(1)}%`}</strong><p>{metrics.firstPassRate === null ? '当前月份、产品或范围暂无可用终检分母。' : `${metrics.good} / ${metrics.inspected} 台 · ${context.month} 首次终检`}</p><small>只计终检「台」的初检记录，过程检验和复验分列；不生成混合公司合格率。</small><Button variant="unstyled" className="co-text-button" onClick={() => { setEvidenceView({ title: '终检首次结果依据', explanation: '分子为终检初检合格台数，分母为同月终检初检台数。复验结果不回写首次结果。', evidence: metrics.firstPassRate === null ? [] : metrics.qualityEvidence }); setSelectedKey(null); }}>查看检验依据<ArrowRight size={13}/></Button></section></div>

    <section className="co-carry" aria-label="跨月未完提醒"><div><h2>跨月未完 <span>{sourceMissing || unavailableScope ? '—' : result.carry.length} 项</span></h2><p>包含所选月份之前的未完事项，以及其他月份已逾期事项。部门和搜索筛选不会隐藏此提醒。</p></div><Button variant="unstyled" disabled={!result.carry.length} onClick={() => setCarryOpen(!carryOpen)}>{carryOpen ? '收起跨月事项' : '展开跨月事项'}<ArrowRight size={14}/></Button></section>
    {carryOpen && result.carry.length ? <section className="co-panel"><div className="co-section-heading"><h2>跨月原任务</h2><span>按原单期限排序</span></div><RiskTable rows={result.carry} today={today} onInspect={inspect}/></section> : null}

    <section className="co-panel" aria-label="跨部门事项"><div className="co-section-heading"><div><h2>本月跨部门待办</h2><p className="co-note">{context.month} 原单月份 · 当前有 {sourceMissing || unavailableScope ? '—' : result.monthRows.length} 项未完；按来源标识去重，部门参与数不相加。</p></div><span className="co-inline-tag"><ClipboardList size={14}/>只读汇总</span></div>
      <div className="co-filters"><label>参与部门<NativeSelect aria-label="参与部门" value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1); }}><option value="all">全部部门</option>{companyDepartments.map((value) => <option key={value} value={value}>{departmentLabels[value]}</option>)}</NativeSelect></label><label className="co-search">搜索事项、经办人或单号<Input aria-label="搜索事项、经办人或单号" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="输入单号或事项关键词"/></label><Button variant="unstyled" onClick={() => { setDepartment('all'); setQuery(''); setPage(1); }}>清除筛选</Button></div>
      {currentRows.length ? <RiskTable rows={currentRows} today={today} onInspect={inspect}/> : <div className="co-empty"><FileText size={24}/><h3>{sourceMissing ? '本次无法读取原任务' : '当前筛选下没有待办'}</h3><p>{sourceMissing ? '恢复来源后再判断本月风险。' : context.scope === 'owned' ? '现有生产样例没有王晴经办事项；未展示其他人员数据。' : '可调整月份、产品或参与部门；跨月未完仍在上方独立提示。'}</p></div>}
      <div className="co-pagination"><span>筛选结果 {result.current.length} 项</span><Button variant="unstyled" disabled={activePage <= 1} onClick={() => setPage(activePage - 1)}>上一页</Button><span>{activePage} / {pages}</span><Button variant="unstyled" disabled={activePage >= pages} onClick={() => setPage(activePage + 1)}>下一页</Button></div>
    </section>

    <div className="co-bottom"><section className="co-panel"><div className="co-section-heading"><h2>本月经办待办分布</h2><span>项 · 单一归属</span></div>{companyDepartments.map((value) => <div className="co-bar-row" key={value}><span>{departmentLabels[value]}</span><div className="co-bar"><span style={{ width: `${result.monthRows.length ? result.counts[value] / result.monthRows.length * 100 : 0}%` }}/></div><b>{sourceMissing || unavailableScope ? '—' : result.counts[value]}</b></div>)}<p className="co-note">分母为本月未完原任务 {sourceMissing || unavailableScope ? '—' : result.monthRows.length} 项；按当前经办部门归属，没有可靠的日趋势来源。</p></section>
      <section className="co-panel"><div className="co-section-heading"><h2>来源与历史依据</h2><span>按业务日期</span></div><p>历史月份沿用原完工日期、检验日期和出货日期。缺少当月目标或记录时，显示缺失或空态。</p><div className="co-source-links"><Button variant="unstyled" onClick={() => inspectMetric('整机完工来源依据', metrics.completed)}>完工原批次<FileText size={14}/></Button><Button variant="unstyled" onClick={() => inspectMetric('QA 放行来源依据', metrics.released)}>QA 授权凭据<FileText size={14}/></Button><Button variant="unstyled" onClick={() => inspectMetric('实际出货来源依据', metrics.shipped)}>实际出库单<FileText size={14}/></Button></div><small>本地读取 {lastRead}。今日在岗尚无共享来源。{unrestrictedPreview ? <Link to={companyHref('/__preview/production-overview', context)}>P00 核对人员确认</Link> : 'P00 人员入口暂不支持当前产品 / 经办范围。'}</small></section></div>

    <Dialog open={Boolean(selectedIssue || evidenceView)} onOpenChange={(open) => { if (!open) closeViews(); }}><DialogContent className="order-horizon-overlay company-overview-overlay co-dialog"><DialogHeader><DialogTitle>{selectedIssue ? selectedIssue.subject : evidenceView?.title}</DialogTitle><DialogDescription>{selectedIssue ? `${selectedIssue.code} · ${selectedIssue.origin}` : evidenceView?.explanation}</DialogDescription></DialogHeader>
      {selectedIssue ? <><dl className="co-detail-meta"><div><dt>当前经办</dt><dd>{selectedIssue.owner}</dd></div><div><dt>截止日期</dt><dd>{selectedIssue.dueDate ?? '原单未确认期限'}</dd></div><div><dt>当前环节</dt><dd>{selectedIssue.node}</dd></div><div><dt>归属产品</dt><dd>{selectedIssue.product ?? '来源尚未确认'}</dd></div></dl><p>{selectedIssue.summary}</p></> : null}
      <div className="co-evidence-list">{(selectedIssue?.evidence ?? evidenceView?.evidence ?? []).length ? (selectedIssue?.evidence ?? evidenceView?.evidence ?? []).map((item) => <article key={item.id}><div><strong>{item.title}</strong><time>{item.date}</time></div><p>{item.description}</p><Link to={item.href}>查看原业务来源<ExternalLink size={13}/></Link></article>) : <p className="co-empty">当前月份、产品或范围没有可展示的来源记录。缺失依据不按零值补齐。</p>}</div>
      {selectedIssue ? <><div className="co-dialog-actions"><Link className="co-primary" to={selectedIssue.href}>打开原始任务<ArrowRight size={14}/></Link><Button variant="unstyled" disabled={role !== 'manager'} onClick={() => draftFor(selectedIssue)}><Sparkles size={14}/>生成催办草稿</Button></div><p className="co-note">AI 建议交互演示：本地规则生成，需核对来源；未调用 AI 服务或发送通知。{role === 'viewer' ? '当前岗位仅可查看。' : ''}</p></> : null}
      {draft && selectedIssue ? <section className="co-draft"><h3>催办草稿 · 未发送</h3><Textarea aria-label="催办草稿" value={draft.body} readOnly rows={9}/><p>只读草稿保留原单编号与依据，不执行指派、改期或发送。</p></section> : null}
    </DialogContent></Dialog>
  </main>;
}
