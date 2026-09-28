import { useAuth } from '../../auth';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { authFetch, readErrorMessage } from '../../lib/authSession';
import { getExecutionOptions } from '../../lib/productionExecutionApi';
import { ProductionMetrics, ProductionPagination } from './ProductionView';
import { productionPage, productionSearch } from './productionViewState';

type Result = { month: string; date: string; productLine: string; targetQty: number; currentSets: number | null; scenarioSets: number | null; calculatedAt: string; notice: string; lines: { code: string; name: string; unit: string; remainingDemand: number; current: number; proposedQty: number; scenarioGap: number | null; problems: string[]; proposal: { quantity: number; availableDate: string; onTime: boolean } | null }[] };
export function ProductionScenarioPanel({ month }: { month: string }) {
  const { user } = useAuth();
  return <ScenarioContent key={JSON.stringify([user?.id, user?.permissions])} month={month} />;
}
function ScenarioContent({ month }: { month: string }) {
  const [models, setModels] = useState<string[]>([]), [productLine, setProductLine] = useState(''), [target, setTarget] = useState(''), [date, setDate] = useState(`${month}-28`);
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [pageNumber, setPageNumber] = useState(1);
  const [proposals, setProposals] = useState<Record<string, { quantity: string; availableDate: string }>>({}), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const dirty = !!result && (result.productLine !== productLine || result.targetQty !== Number(target) || result.date !== date || result.lines.some(row => { const proposal = proposals[row.code]; return Number(proposal?.quantity || 0) !== (row.proposal?.quantity ?? 0) || (!!Number(proposal?.quantity) && proposal?.availableDate !== row.proposal?.availableDate); }));
  useEffect(() => { const abort = new AbortController(); getExecutionOptions(abort.signal).then(value => { if (!abort.signal.aborted) setModels(value.models); }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); }); return () => { abort.abort(); controller.current?.abort(); generation.current++; }; }, []);
  useEffect(() => { generation.current++; controller.current?.abort(); setBusy(false); setResult(null); setProposals({}); setDate(`${month}-28`); }, [month]);
  const page = productionPage(result?.lines.filter(row => productionSearch(search, [row.code, row.name])) ?? [], pageNumber);
  async function simulate() {
    const run = ++generation.current; controller.current?.abort(); controller.current = new AbortController(); setBusy(true); setError('');
    try {
      const response = await authFetch('/api/procurement/production-scenarios/simulate', { method: 'POST', signal: controller.current.signal, body: JSON.stringify({ month, productLine, targetQty: Number(target), date,
        proposals: Object.entries(proposals).filter(([, row]) => row.quantity.trim() && Number(row.quantity) !== 0).map(([code, row]) => ({ code, quantity: Number(row.quantity), availableDate: row.availableDate })) }) });
      if (!response.ok) throw new Error(await readErrorMessage(response, '情景试算失败'));
      const value = await response.json() as Result;
      if (generation.current === run) { setResult(value); setPageNumber(1); }
    } catch (cause) { if (generation.current === run && !controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : '试算失败'); }
    finally { if (generation.current === run) setBusy(false); }
  }
  return <section className="space-y-4" aria-label="草稿情景试算">
    <div className="production-surface p-5"><h2 className="text-lg font-semibold">草稿情景试算</h2><p className="mt-2 text-sm text-muted-foreground">下月尚未确认目标，也可以先比较供给与缺口。试算结果不产生正式计划或采购。</p>
      <form className="mt-5 flex flex-wrap items-end gap-4" onSubmit={event => { event.preventDefault(); void simulate(); }}><label className="space-y-2 text-sm">生产 BOM 型号<NativeSelect required aria-label="情景 BOM 型号" value={productLine} onChange={event => { generation.current++; controller.current?.abort(); setBusy(false); setProductLine(event.target.value); setProposals({}); setResult(null); }}><option value="">请选择</option>{models.map(model => <option key={model}>{model}</option>)}</NativeSelect></label><label className="space-y-2 text-sm">草稿整机目标（台）<Input required type="number" min="1" step="1" value={target} onChange={event => setTarget(event.target.value)} /></label><label className="space-y-2 text-sm">草稿需求日期<Input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label><Button disabled={busy}>{busy ? '正在试算…' : '试算情景'}</Button></form>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </div>
    {result && <><p className="production-note">{result.notice}</p>{dirty && <p role="status" className="text-sm text-amber-700">条件已更改，下方仍是上次结果。点击“试算情景”更新。</p>}
      <ProductionMetrics items={[{ label: '上次草稿目标', value: `${result.targetQty} 台` }, { label: '未占用现货可覆盖', value: result.currentSets == null ? '待核对' : `${result.currentSets} 台` }, { label: '含未下单方案预计覆盖', value: result.scenarioSets == null ? '待核对' : `${result.scenarioSets} 台` }]} />
      <section className="production-surface"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h3 className="font-medium">物料缺口与未下单方案</h3><p className="mt-1 text-xs text-muted-foreground">{result.date} 需求 · {new Date(result.calculatedAt).toLocaleString()} 计算</p></div><Input className="w-64" placeholder="搜索物料" aria-label="搜索情景物料" value={search} onChange={event => { setSearch(event.target.value); setPageNumber(1); }} /></div>
        <Table className="min-w-[900px]"><TableHeader><TableRow>{['物料','草稿需求','净现货覆盖','未下单方案量','方案检验后可用日','含方案缺口'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(row => <TableRow key={row.code}><TableCell><strong>{row.name}</strong><p className="text-xs text-muted-foreground">{row.code} · {row.unit}</p>{row.problems.map(problem => <p key={problem} className="text-xs text-amber-700">{problem}</p>)}</TableCell><TableCell>{row.remainingDemand}</TableCell><TableCell>{row.problems.length ? '待核对' : row.current}</TableCell><TableCell><Input className="w-28" type="number" min="0" step="0.001" aria-label={`${row.name} 未下单方案数量`} value={proposals[row.code]?.quantity ?? ''} onChange={event => setProposals(previous => ({ ...previous, [row.code]: { availableDate: previous[row.code]?.availableDate ?? '', quantity: event.target.value } }))} /></TableCell><TableCell><Input className="w-44" type="date" aria-label={`${row.name} 方案可用日`} value={proposals[row.code]?.availableDate ?? ''} onChange={event => setProposals(previous => ({ ...previous, [row.code]: { quantity: previous[row.code]?.quantity ?? '', availableDate: event.target.value } }))} />{row.proposal && !row.proposal.onTime && <p className="mt-1 text-xs text-amber-700">晚于需求日，未计入覆盖</p>}</TableCell><TableCell>{row.scenarioGap ?? '待核对'}</TableCell></TableRow>)}</TableBody></Table><ProductionPagination {...page} onPageChange={setPageNumber} /></section>
    </>}
  </section>;
}
