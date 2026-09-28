import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { useI18n } from '../../lib/i18n';
import { getKeyMaterialDirectory, getKeyMaterialHistory, saveKeyMaterialMapping, searchKeyMaterials, type KeyMaterial, type KeyMaterialDirectory, type KeyMaterialMapping } from '../../lib/keyMaterialsApi';
import { keyMaterialPage, keyMaterialSearch } from './keyMaterialWorkspaceModel';
import { KeyMaterialPagination } from './KeyMaterialPagination';

export function KeyMaterialFormalDirectory({ data, onSaved }: { data: KeyMaterialDirectory; onSaved: () => void }) {
  const { t } = useI18n(), [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<KeyMaterial | 'new' | null>(null);
  const change = (patch: Record<string, string | null>) => setParams(current => keyMaterialSearch(current, patch));
  const query = params.get('formalQ') || '', scope = params.get('formalScope') || 'included';
  const keyword = query.trim().toLocaleLowerCase();
  const rows = data.materials.filter(row => (row.scope?.inclusion ?? 'included') === scope)
    .filter(row => `${row.name} ${row.spec} ${row.tpInventoryCode || row.erpCode} ${row.category}`.toLocaleLowerCase().includes(keyword));
  const page = keyMaterialPage(rows, params.get('formalPage'));
  const activeCount = data.materials.filter(row => row.scope?.inclusion !== 'excluded').length;
  return <section className="km-workspace-monthly" aria-label={t('正式关键物料目录')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{t('当前纳入')} <strong className="text-xl font-semibold tabular-nums text-foreground">{activeCount}</strong> {t('种正式物料')}<span className="ml-3 text-xs">{t('无需求、不缺料时仍保留；退出可恢复。')}</span></p>
      {data.canReview && <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden="true" />{t('纳入物料')}</Button>}
    </div>
    <div className="km-workspace-surface km-workspace-results">
      <div className="km-workspace-toolbar">
        <div className="km-workspace-search"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label={t('搜索正式关键物料')} placeholder={t('物料名称、正式编码、规格或分类')} value={query} onChange={event => change({ formalQ: event.target.value, formalPage: null })} /></div>
        <NativeSelect aria-label={t('正式目录范围')} value={scope} onChange={event => change({ formalScope: event.target.value, formalPage: null })}><option value="included">{t('当前纳入')}</option><option value="excluded">{t('已退出')}</option></NativeSelect>
      </div>
      {rows.length ? <div className="km-workspace-table-scroll"><Table containerClassName="overflow-visible" className="min-w-[760px]">
        <TableHeader><TableRow>{['正式物料 / 编码', '规格 / 单位', '分类', '纳入依据', '操作'].map(label => <TableHead key={label}>{t(label)}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{page.items.map(row => <TableRow key={row.id}>
          <TableCell className="whitespace-normal"><p className="font-medium">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.tpInventoryCode || row.erpCode || t('编码待补齐')}</p></TableCell>
          <TableCell className="whitespace-normal text-sm">{row.spec || '—'}<p className="mt-1 text-xs text-muted-foreground">{row.unit || t('单位待补齐')}</p></TableCell>
          <TableCell className="text-sm">{row.category || t('未分类')}</TableCell>
          <TableCell className="max-w-80 whitespace-normal text-xs"><p className="line-clamp-2 break-words">{row.scope?.note || t('沿用已核对会议映射')}</p><p className="mt-1 text-muted-foreground">{row.scope?.actorName}{row.scope?.at ? ' · ' + new Date(row.scope.at).toLocaleString() : ''}</p></TableCell>
          <TableCell><div className="flex flex-wrap gap-1">{scope === 'included' && <Button asChild variant="ghost" size="sm"><Link to={'?' + keyMaterialSearch(params, { material: row.id })}>{t('需求与缺口')}</Link></Button>}<Button variant="ghost" size="sm" onClick={() => setEditing(row)}>{t(data.canReview ? '范围与历史' : '查看历史')}</Button></div></TableCell>
        </TableRow>)}</TableBody>
      </Table></div> : <div className="p-8 text-center"><p className="text-sm text-muted-foreground">{t(query ? '没有符合搜索条件的物料。' : scope === 'excluded' ? '暂无退出记录。' : '尚未纳入正式物料，请从物料库选择。')}</p>{query ? <Button variant="link" onClick={() => change({ formalQ: null, formalPage: null })}>{t('清除搜索')}</Button> : scope === 'included' && data.canReview && <Button className="mt-3" variant="outline" onClick={() => setEditing('new')}>{t('从物料库选择')}</Button>}</div>}
      <KeyMaterialPagination {...page} onPage={value => change({ formalPage: String(value) })} />
    </div>
    {editing && <KeyMaterialScopeDialog initial={editing === 'new' ? null : editing} canReview={data.canReview} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />}
  </section>;
}

export function KeyMaterialScopeDialog({ initial, canReview, onClose, onSaved }: { initial: KeyMaterial | null; canReview: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(), id = useId();
  const [material, setMaterial] = useState(initial), [current, setCurrent] = useState<KeyMaterialMapping | null>(null);
  const [inclusion, setInclusion] = useState<'included' | 'excluded'>('included'), [note, setNote] = useState('');
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof searchKeyMaterials>> | null>(null), [history, setHistory] = useState<KeyMaterialMapping[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const locked = useRef(false), request = useRef<{ signature: string; id: string } | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError('');
    const load = material ? Promise.all([getKeyMaterialDirectory(controller.signal), getKeyMaterialHistory(`material:${material.id}`, controller.signal)]).then(([directory, entries]) => {
      if (controller.signal.aborted) return;
      const scope = directory.materials.find(row => row.id === material.id)?.scope ?? null;
      setCurrent(scope); setInclusion(scope?.inclusion === 'excluded' ? 'excluded' : 'included'); setHistory(entries);
    }) : searchKeyMaterials(search, page, controller.signal).then(found => { if (!controller.signal.aborted) setOptions(found); });
    load.catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : t('读取失败')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [material?.id, search, page, reload, t]);
  const dirty = Boolean(note || (current && inclusion !== current.inclusion));
  const close = () => { if (!locked.current) dirty ? setDiscard(true) : onClose(); };
  async function save() {
    if (!material || !canReview || locked.current || loading || loadError) return;
    if (!note.trim()) { setError(t('请填写纳入或退出的依据')); return; }
    const input = { version: current?.version ?? 0, materialIds: inclusion === 'included' ? [material.id] : [], inclusion, note: note.trim() };
    const signature = JSON.stringify([material.id, input]);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    locked.current = true; setBusy(true); setError('');
    try { await saveKeyMaterialMapping(`material:${material.id}`, { ...input, requestId: request.current.id }); if (mounted.current) onSaved(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : t('保存失败，草稿已保留')); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{t(material ? '关键物料范围与历史' : '从物料库纳入')}</DialogTitle><DialogDescription>{t('仅引用正式物料，不新建主档。退出后停止月度跟踪，保留历史并支持恢复。')}</DialogDescription></DialogHeader>
    {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
    {!material ? <>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setSearch(q); setPage(1); setReload(value => value + 1); }}><Input aria-label={t('搜索待纳入物料')} placeholder={t('名称、编码或规格')} value={q} onChange={event => setQ(event.target.value)} /><Button variant="outline" type="submit">{t('搜索')}</Button></form>
      {loading ? <p role="status" className="text-sm text-muted-foreground">{t('正在查找物料')}</p> : <div className="max-h-80 overflow-y-auto rounded-lg border border-border">{options?.items.length ? options.items.map(row => <div key={row.id} className="flex items-center justify-between gap-3 border-b border-border p-3 last:border-0"><div className="min-w-0"><p className="break-words text-sm font-medium">{row.name}</p><p className="mt-1 break-words text-xs text-muted-foreground">{row.tpInventoryCode || row.erpCode || t('待补正式编码')} · {row.spec || '—'} · {row.unit || '—'}</p></div><Button variant="outline" size="sm" disabled={!canReview || !(row.tpInventoryCode?.trim() || row.erpCode.trim()) || Boolean(loadError)} onClick={() => setMaterial(row)}>{t('选择')}</Button></div>) : <p className="p-4 text-sm text-muted-foreground">{t('没有匹配物料，请先在物料库补齐正式资料。')}</p>}</div>}
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground"><span>{t('第 {page} 页，共 {count} 条', { page, count: options?.total ?? 0 })}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>{t('上一页')}</Button><Button variant="outline" size="sm" disabled={loading || !options || page * options.pageSize >= options.total} onClick={() => setPage(value => value + 1)}>{t('下一页')}</Button></div></div>
    </> : <>
      <div className="rounded-lg border border-border p-3"><p className="font-medium">{material.name}</p><p className="mt-1 text-xs text-muted-foreground">{material.tpInventoryCode || material.erpCode} · {material.spec || '—'} · {material.unit}</p></div>
      {loading && <p role="status" className="text-sm text-muted-foreground">{t('正在核对最新范围与历史')}</p>}
      {canReview && <fieldset disabled={busy || loading || Boolean(loadError)} className="space-y-4">
        <div className="space-y-2"><Label htmlFor={`${id}-scope`}>{t('目录范围')}</Label><NativeSelect id={`${id}-scope`} value={inclusion} onChange={event => setInclusion(event.target.value as 'included' | 'excluded')}><option value="included">{t(current?.inclusion === 'excluded' ? '恢复纳入' : '纳入')}</option><option value="excluded">{t('退出跟踪')}</option></NativeSelect></div>
        <div className="space-y-2"><Label htmlFor={`${id}-reason`}>{t('变更依据（必填）')}</Label><Textarea id={`${id}-reason`} maxLength={4000} value={note} onChange={event => setNote(event.target.value)} placeholder={t('说明纳入、退出或恢复的原因')} /></div>
      </fieldset>}
      <section className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">{t('范围历史')}</h3>{history.length ? [...history].sort((a, b) => b.version - a.version).map(entry => <div key={entry.version} className="text-xs"><p className="font-medium">{t(entry.inclusion === 'included' ? '纳入' : '退出跟踪')} · v{entry.version} · {entry.actorName}</p><p className="mt-1 text-muted-foreground">{entry.at ? new Date(entry.at).toLocaleString() : '—'}</p><p className="mt-1 whitespace-pre-wrap break-words">{entry.note}</p></div>) : <p className="text-xs text-muted-foreground">{t(current ? '沿用会议映射，原始核对记录在资料核对中保留。' : '尚未纳入，无范围变更记录。')}</p>}</section>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {(error || loadError) && <Button variant="outline" disabled={busy || loading} onClick={() => { setReload(value => value + 1); setError(''); }}>{t('重新核对最新版本（保留原因）')}</Button>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>{t('返回')}</Button>{material && canReview && <Button disabled={busy || loading || Boolean(loadError)} onClick={() => void save()}>{t(busy ? '正在保存…' : inclusion === 'excluded' ? '确认退出跟踪' : '确认纳入')}</Button>}</DialogFooter>
  </DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃未保存的修改？')}</AlertDialogTitle><AlertDialogDescription>{t('已保存的范围和历史不会改变。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续编辑')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('放弃并返回')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
