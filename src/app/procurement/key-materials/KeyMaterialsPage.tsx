import { KeyMaterialMonthlyPanel } from './KeyMaterialMonthlyPanel';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Boxes, Check, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { usePermission } from '../../hooks/usePermission';
import { useI18n } from '../../lib/i18n';
import { routePath } from '../../lib/routePaths';
import { getKeyMaterialDirectory, getKeyMaterialHistory, saveKeyMaterialMapping, searchKeyMaterials, type KeyMaterial, type KeyMaterialClue, type KeyMaterialDirectory, type KeyMaterialMapping } from '../../lib/keyMaterialsApi';
import '../../order-processing/horizon.css';

const number = (value?: number | null) => value == null ? '待补齐' : value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
export function KeyMaterialsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<KeyMaterialDirectory | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<KeyMaterialClue | null>(null);
  const canMaterials = usePermission('page:proc-materials');
  const query = params.get('q') || '', filter = params.get('filter') || 'all';
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getKeyMaterialDirectory(controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('目录读取失败')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version, t]);
  const materials = useMemo(() => new Map(data?.materials.map((row) => [row.id, row]) ?? []), [data]);
  const clues = data?.clues.filter((row) => {
    const details = row.mapping.materialIds.map((id) => materials.get(id));
    const missing = !details.length || details.some((material) => !material || material.available == null || !material.syncedAt);
    return (filter !== 'unverified' || missing || !row.mapping.at) && `${row.id} ${row.name} ${row.group} ${details.map((material) => `${material?.name} ${material?.tpInventoryCode} ${material?.spec}`).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  }) ?? [];
  function change(key: string, value: string) { setParams((previous) => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; }); }
  return <main className="order-horizon mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
    <OrderPageHeader Icon={Boxes} eyebrow={t('供应链 / S18')} title={t('关键物料')} description={t('从会议线索核对正式料号，查看同一份物料与库存记录。')} actions={<Button variant="outline" disabled={loading} onClick={() => setVersion((value) => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新')}</Button>} />
    <KeyMaterialMonthlyPanel />
    <Card className="gap-4 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-balance font-semibold">{t('全量核对目录')}</h2><p className="mt-1 text-pretty text-sm text-muted-foreground">{t('31 条线索不等于 31 个 SKU；同料多条线索只引用同一个正式物料。')}</p></div><span className="text-sm tabular-nums text-muted-foreground">{data ? `${data.clues.filter((row) => row.mapping.at).length} / 31 ${t('已核对')}` : '—'}</span></div><div className="flex flex-wrap items-center gap-3"><div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label={t('搜索关键物料')} value={query} onChange={(event) => change('q', event.target.value)} placeholder={t('搜索名称、正式编码或规格')} className="pl-9" /></div><NativeSelect aria-label={t('目录范围')} value={filter} onChange={(event) => change('filter', event.target.value)}><option value="all">{t('全部线索')}</option><option value="unverified">{t('资料待核')}</option></NativeSelect></div></Card>
    {error ? <Card role="alert" className="p-5"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setVersion((value) => value + 1)}>{t('重新加载')}</Button></Card> : loading ? <div role="status" aria-label={t('加载目录')} className="space-y-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-28 w-full rounded-2xl" />)}</div> : clues.length === 0 ? <Card className="p-8 text-center"><p className="text-muted-foreground">{t('没有匹配的线索')}</p><Button variant="outline" onClick={() => { setParams((previous) => { const next = new URLSearchParams(previous); next.delete('q'); next.delete('filter'); return next; }); }}>{t('清除筛选')}</Button></Card> : <div className="space-y-3">{clues.map((clue) => <Card key={clue.id} className="gap-3 p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs text-muted-foreground">{clue.id} · {clue.group}</p><h2 className="mt-1 text-balance text-base font-semibold">{clue.name}</h2><p className="mt-1 text-pretty text-sm text-muted-foreground">{clue.check}</p></div><Button variant="outline" size="sm" onClick={() => setSelected(clue)}>{t(data?.canReview ? '核对料号' : '核对记录')}</Button></div>
      {!clue.mapping.materialIds.length ? <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{t(clue.mapping.inclusion === 'excluded' ? '已确认不纳入，核对依据已保留。' : clue.mapping.inclusion === 'pending' ? '纳入范围待确认。' : '待关联正式物料；无需求或无缺料时仍保留本条。')}</p> : <div className="divide-y divide-border">{clue.mapping.materialIds.map((id) => {
        const material = materials.get(id); const code = material?.tpInventoryCode || material?.erpCode;
        return <div key={id} className="grid gap-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_8rem]"><div className="min-w-0"><p className="font-medium">{material?.name ?? t('关联物料已不可用，请重新核对')}</p><p className="mt-1 break-words text-xs text-muted-foreground">{code || id} · {material?.spec} · {material?.productLine}</p>{canMaterials && code && <Link className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline" to={`${routePath('page:proc-materials', '/proc-materials')}?materialCode=${encodeURIComponent(code)}`}>{t('查看库存、订单与物料详情')}</Link>}</div><div><p className="text-xs text-muted-foreground">{t('量产仓可用')}</p><p className="mt-1 tabular-nums">{number(material?.available)} {material?.unit}</p></div><div><p className="text-xs text-muted-foreground">{t('ERP 在途')}</p><p className="mt-1 tabular-nums">{number(material?.inTransit)} {material?.unit}</p></div><p className="text-xs text-muted-foreground sm:col-span-3">{t('库存同步')}：{material?.syncedAt ? new Date(material.syncedAt).toLocaleString() : t('待补齐')} · {t('当前库存快照，不代表所选月份历史库存或按期齐套。')}</p></div>;
      })}</div>}
      {clue.mapping.at && <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5" aria-hidden="true" />{clue.mapping.actorName} · {new Date(clue.mapping.at).toLocaleString()} · {clue.mapping.note}</p>}
    </Card>)}</div>}
    <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('“CFO”“西安美”保留为待核原词，不自动创建物料或供应商。塑料与硅胶范围须按正式明细逐项核对。')}</p>
    {selected && data && <KeyMaterialMappingDialog key={selected.id} clue={selected} materials={data.materials} canReview={data.canReview} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); setVersion((value) => value + 1); }} />}
  </main>;
}

function KeyMaterialMappingDialog({ clue, materials, canReview, onClose, onSaved }: { clue: KeyMaterialClue; materials: KeyMaterial[]; canReview: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(), id = useId();
  const [ids, setIds] = useState(clue.mapping.materialIds), [inclusion, setInclusion] = useState(clue.mapping.inclusion), [note, setNote] = useState('');
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [options, setOptions] = useState<{ items: KeyMaterial[]; total: number } | null>(null), [history, setHistory] = useState<KeyMaterialMapping[]>([]);
  const [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const labels = useRef(new Map(materials.map((row) => [row.id, row]))), locked = useRef(false), request = useRef<{ signature: string; id: string } | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = note !== '' || inclusion !== clue.mapping.inclusion || JSON.stringify(ids) !== JSON.stringify(clue.mapping.materialIds);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError('');
    Promise.all([getKeyMaterialHistory(clue.id, controller.signal), canReview ? searchKeyMaterials(search, page, controller.signal) : Promise.resolve(null)]).then(([entries, found]) => {
      if (controller.signal.aborted) return; setHistory(entries); setOptions(found); found?.items.forEach((row) => labels.current.set(row.id, row));
    }).catch((cause) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : t('读取失败')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clue.id, canReview, search, page, reload, t]);
  function close() { if (!busy) dirty ? setDiscard(true) : onClose(); }
  async function save() {
    if (locked.current) return;
    if (!note.trim() || (inclusion === 'included' && !ids.length)) { setError(t('请选择正式物料并填写核对依据')); return; }
    locked.current = true; setBusy(true); setError('');
    const input = { version: clue.mapping.version, materialIds: inclusion === 'included' ? ids : [], inclusion, note: note.trim() };
    const signature = JSON.stringify(input); if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try { await saveKeyMaterialMapping(clue.id, { ...input, requestId: request.current.id }); if (mounted.current) onSaved(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : t('保存失败，草稿已保留')); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{clue.id} · {clue.name}</DialogTitle><DialogDescription className="text-pretty">{clue.check}</DialogDescription></DialogHeader>
    {loadError ? <div role="alert"><p className="text-sm text-destructive">{loadError}</p><Button variant="outline" onClick={() => setReload((value) => value + 1)}>{t('重新读取')}</Button></div> : null}
    {canReview && <fieldset disabled={busy} className="space-y-4"><div className="space-y-2"><Label htmlFor={`${id}-state`}>{t('纳入状态')}</Label><NativeSelect id={`${id}-state`} disabled={clue.kind !== 'candidate'} value={inclusion} onChange={(event) => setInclusion(event.target.value as KeyMaterialMapping['inclusion'])}><option value="included">{t('纳入')}</option>{clue.kind === 'candidate' && <><option value="pending">{t('待确认')}</option><option value="excluded">{t('不纳入')}</option></>}</NativeSelect></div>
      {inclusion === 'included' && <><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(q); setPage(1); }}><Input aria-label={t('搜索正式料号')} value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('名称、编码或规格')} /><Button type="submit" variant="outline">{t('搜索')}</Button></form><div className="flex flex-wrap gap-2">{ids.map((item) => <Button key={item} size="sm" variant="secondary" onClick={() => setIds((current) => current.filter((value) => value !== item))} aria-label={t('移除 {name}', { name: labels.current.get(item)?.name || item })}>{labels.current.get(item)?.name || item} ×</Button>)}</div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-border">{loading ? <p role="status" className="p-4 text-sm text-muted-foreground">{t('正在查找物料')}</p> : options?.items.length ? options.items.map((material) => <label key={material.id} className="flex cursor-pointer items-start gap-3 border-b border-border p-3 last:border-0"><Checkbox checked={ids.includes(material.id)} disabled={!material.tpInventoryCode && !material.erpCode} onCheckedChange={(checked) => setIds((current) => checked === true ? [...new Set([...current, material.id])] : current.filter((value) => value !== material.id))} /><span className="min-w-0 text-sm"><span className="font-medium">{material.name}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{material.tpInventoryCode || material.erpCode || t('待补正式编码')} · {material.spec} · {material.unit}</span></span></label>) : <p className="p-4 text-sm text-muted-foreground">{t('没有匹配的正式物料，请先在物料库导入或补齐编码。')}</p>}</div>
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="tabular-nums">{page} · {options?.total ?? '—'} {t('条物料')}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page === 1} aria-label={t('上一页')} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button><Button size="sm" variant="outline" disabled={loading || !options || page * 30 >= options.total} aria-label={t('下一页')} onClick={() => setPage((value) => value + 1)}><ChevronRight className="size-4" aria-hidden="true" /></Button></div></div></>}
      <div className="space-y-2"><Label htmlFor={`${id}-note`}>{t('核对依据')}</Label><Textarea id={`${id}-note`} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('说明正式名称、规格、材质及映射依据')} /></div>
    </fieldset>}
    <section className="space-y-2 border-t border-border pt-4"><h3 className="text-sm font-semibold">{t('历史核对')}</h3>{history.length ? history.map((entry) => <div key={entry.version} className="rounded-lg bg-muted/50 p-3 text-xs"><p>{entry.actorName} · {entry.at ? new Date(entry.at).toLocaleString() : '—'} · v{entry.version}</p><p className="mt-1 whitespace-pre-wrap">{entry.note}</p><p className="mt-1 break-all text-muted-foreground">{entry.materialIds.map((item) => labels.current.get(item)?.name || item).join('、') || t('未映射')}</p></div>) : <p className="text-xs text-muted-foreground">{t('暂无核对记录')}</p>}</section>
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={close}>{t('返回')}</Button>{canReview && <Button disabled={busy || loading || Boolean(loadError)} onClick={() => void save()}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t('确认映射')}</Button>}</DialogFooter>
  </DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃未保存的核对？')}</AlertDialogTitle><AlertDialogDescription>{t('已保存的目录和历史不会改变。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续核对')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('放弃并返回')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
