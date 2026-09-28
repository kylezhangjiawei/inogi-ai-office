import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Boxes, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { HorizonPageHeader } from '../../components/horizon/HorizonPage';
import { useI18n } from '../../lib/i18n';
import { getKeyMaterialDirectory, getKeyMaterialHistory, saveKeyMaterialMapping, searchKeyMaterials, type KeyMaterial, type KeyMaterialClue, type KeyMaterialDirectory, type KeyMaterialMapping } from '../../lib/keyMaterialsApi';
import { KeyMaterialMonthlyPanel } from './KeyMaterialMonthlyPanel';
import { KeyMaterialDirectoryView } from './KeyMaterialDirectoryView';
import { KeyMaterialFormalDirectory } from './KeyMaterialFormalDirectory';
import { keyMaterialSearch } from './keyMaterialWorkspaceModel';
import './key-materials-workspace.css';

export function KeyMaterialsPage() {
  const { user } = useAuth();
  return <KeyMaterialsWorkspace key={JSON.stringify([user?.id, [...(user?.permissions ?? [])].sort()])} />;
}
function KeyMaterialsWorkspace() {
  const { t } = useI18n(), [params, setParams] = useSearchParams();
  const [data, setData] = useState<KeyMaterialDirectory | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<KeyMaterialClue | null>(null);
  const view = params.get('clue') || params.get('view') === 'review' ? 'review' : params.get('view') === 'monthly' ? 'monthly' : 'directory';
  const detail = Boolean(params.get('material') || params.get('clue'));
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getKeyMaterialDirectory(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('目录读取失败')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version, t]);
  return <main className={`horizon-theme km-workspace${detail ? "" : " km-workspace--list"}`}>
    <HorizonPageHeader Icon={Boxes} eyebrow={t('供应链管理')} title={t('关键物料')} className="km-workspace-command"
      meta={!detail ? <Tabs value={view} onValueChange={value => setParams(current => keyMaterialSearch(current, { view: value === 'directory' ? null : value, material: null, clue: null }))}><TabsList className="km-workspace-tabs" aria-label={t('关键物料视图')}><TabsTrigger value="directory" id="km-directory-tab" aria-controls="km-directory-panel">{t('全量目录')}</TabsTrigger><TabsTrigger value="monthly" id="km-monthly-tab" aria-controls="km-monthly-panel">{t('月度跟踪')}</TabsTrigger><TabsTrigger value="review" id="km-review-tab" aria-controls="km-review-panel">{t('资料核对')}</TabsTrigger></TabsList></Tabs> : undefined}
      actions={<Button variant="outline" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新目录')}</Button>} />
    <div className="km-workspace-content" role={detail ? undefined : 'tabpanel'} id={detail ? undefined : `km-${view}-panel`} aria-labelledby={detail ? undefined : `km-${view}-tab`}>
    {params.get('material') || view === 'monthly' ? <KeyMaterialMonthlyPanel key={version} />
      : error ? <section role="alert" className="km-workspace-surface p-5"><p className="text-sm text-destructive">{error}</p><Button className="mt-3" variant="outline" onClick={() => setVersion(value => value + 1)}>{t('重新加载')}</Button></section>
        : loading ? <div role="status" aria-label={t('加载目录')} className="space-y-3">{[0, 1, 2].map(key => <Skeleton key={key} className="h-20 w-full rounded-xl" />)}</div>
          : data && (view === 'review' ? <KeyMaterialDirectoryView data={data} onReview={setSelected} /> : <KeyMaterialFormalDirectory data={data} onSaved={() => setVersion(value => value + 1)} />)}
    </div>
    {!detail && view === 'review' && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('会议线索不等于正式 SKU。原核对记录保留；已退出物料不会因旧映射重新纳入。')}</p>}
    {selected && data && <KeyMaterialMappingDialog key={selected.id} clue={selected} materials={data.materials} canReview={data.canReview} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); setVersion(value => value + 1); }} />}
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
