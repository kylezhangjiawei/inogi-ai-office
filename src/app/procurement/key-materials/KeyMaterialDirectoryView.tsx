import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useI18n } from '../../lib/i18n';
import type { KeyMaterialClue, KeyMaterialDirectory } from '../../lib/keyMaterialsApi';
import { clueNeedsReview, keyMaterialPage, keyMaterialSearch } from './keyMaterialWorkspaceModel';
import { KeyMaterialPagination } from './KeyMaterialPagination';

export function KeyMaterialDirectoryView({ data, onReview }: { data: KeyMaterialDirectory; onReview: (clue: KeyMaterialClue) => void }) {
  const { t } = useI18n(), [params, setParams] = useSearchParams();
  const materials = useMemo(() => new Map(data.materials.map(row => [row.id, row])), [data]);
  const query = params.get('q') || '', filter = params.get('filter') || 'all', group = params.get('group') || '';
  const selectedId = params.get('clue'), selected = data.clues.find(clue => clue.id === selectedId);
  const change = (patch: Record<string, string | null>) => setParams(current => keyMaterialSearch(current, patch));
  const href = (patch: Record<string, string | null>) => `?${keyMaterialSearch(params, patch)}`;
  const filtered = data.clues.filter(row => (!group || row.group === group) && (filter !== 'unverified' || clueNeedsReview(row, materials)))
    .filter(row => `${row.id} ${row.name} ${row.group} ${row.mapping.materialIds.map(id => { const material = materials.get(id); return `${material?.name || ''} ${material?.tpInventoryCode || material?.erpCode || ''} ${material?.spec || ''}`; }).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const page = keyMaterialPage(filtered, params.get('page'));
  const mappingLabel = (clue: KeyMaterialClue) => clue.mapping.inclusion === 'excluded' ? '已确认不纳入' : clue.mapping.inclusion === 'pending' ? '纳入范围待确认' : !clue.mapping.materialIds.length ? '待关联正式料号' : clueNeedsReview(clue, materials) ? '资料待核' : '已核对';

  if (selectedId) return <section className="space-y-4" aria-label={t('关键物料线索详情')}>
    <Button variant="ghost" onClick={() => change({ clue: null, view: 'review' })}><ArrowLeft className="size-4" aria-hidden="true" />{t('返回资料核对')}</Button>
    {!selected ? <div role="status" className="km-workspace-surface p-6 text-sm text-muted-foreground">{t('这条线索已不在当前目录，请返回重新选择。')}</div> : <>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{selected.id} · {selected.group}</p><h2 className="mt-1 text-xl font-semibold text-balance">{selected.name}</h2><p className="mt-2 text-sm text-pretty text-muted-foreground">{selected.check}</p></div><Button variant="outline" onClick={() => onReview(selected)}>{t(data.canReview ? '核对料号' : '核对记录')}</Button></div>
      <div className="km-workspace-detail-grid">
        <section className="km-workspace-surface km-workspace-detail-section"><h2>{t('关联正式物料')}</h2><p className="mb-4 text-xs text-muted-foreground">{t('同料多条线索引用同一正式物料，数量不重复累计。')}</p>
          {!selected.mapping.materialIds.length ? <p className="text-sm text-muted-foreground">{t(mappingLabel(selected))}</p> : <ul className="km-workspace-detail-list">{selected.mapping.materialIds.map(id => { const material = materials.get(id); return <li key={id}>{material ? <Link className="flex items-start justify-between gap-4 text-sm font-medium hover:text-primary" to={href({ material: id })}><span>{material.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{material.tpInventoryCode || material.erpCode || t('编码待补齐')} · {material.spec || t('规格待补齐')}</span></span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link> : <p className="text-sm text-muted-foreground">{t('关联物料已不可用，请重新核对')}</p>}</li>; })}</ul>}
        </section>
        <aside className="km-workspace-surface km-workspace-detail-section"><h2>{t('核对依据')}</h2><dl className="space-y-4 text-sm"><div><dt className="text-xs text-muted-foreground">{t('当前状态')}</dt><dd className="mt-1">{t(mappingLabel(selected))}</dd></div><div><dt className="text-xs text-muted-foreground">{t('核对人及时间')}</dt><dd className="mt-1">{selected.mapping.at ? `${selected.mapping.actorName} · ${new Date(selected.mapping.at).toLocaleString()}` : t('尚未核对')}</dd></div><div><dt className="text-xs text-muted-foreground">{t('核对说明')}</dt><dd className="mt-1 whitespace-pre-wrap text-pretty">{selected.mapping.note || t('尚未填写')}</dd></div></dl></aside>
      </div>
    </>}
  </section>;

  return <section className="km-workspace-surface km-workspace-results" aria-label={t('全量核对目录')}>
    <div className="km-workspace-toolbar"><div className="km-workspace-search"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label={t('搜索关键物料')} value={query} onChange={event => change({ q: event.target.value, page: null })} placeholder={t('名称、正式编码或规格')} className="pl-9" /></div><NativeSelect aria-label={t('目录分组')} value={group} onChange={event => change({ group: event.target.value, page: null })}><option value="">{t('全部分组')}</option>{[...new Set(data.clues.map(row => row.group))].map(name => <option key={name} value={name}>{name}</option>)}</NativeSelect><NativeSelect aria-label={t('目录范围')} value={filter} onChange={event => change({ filter: event.target.value, page: null })}><option value="all">{t('全部线索')}</option><option value="unverified">{t('资料待核')}</option></NativeSelect></div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground"><p>{t('31 条线索不等于 31 个 SKU；无本月需求的物料仍保留。')}</p><span className="tabular-nums">{t('已核对 {count} 条', { count: data.clues.filter(row => row.mapping.at).length })}</span></div>
    {!filtered.length ? <div className="p-8 text-center"><p className="text-sm text-muted-foreground">{t('没有匹配的线索')}</p><Button variant="link" onClick={() => change({ q: null, filter: null, group: null, page: null })}>{t('清除筛选')}</Button></div> : <div className="km-workspace-table-scroll"><Table containerClassName="overflow-visible" className="min-w-[650px]"><TableHeader><TableRow>{['线索 / 分组', '关联正式物料', '核对状态', '操作'].map(label => <TableHead key={label}>{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody>{page.items.map(clue => <TableRow key={clue.id}><TableCell className="w-[30%] whitespace-normal"><Link to={href({ clue: clue.id })} className="font-medium hover:text-primary hover:underline">{clue.name}</Link><p className="mt-1 text-xs text-muted-foreground">{clue.id} · {clue.group}</p></TableCell><TableCell className="whitespace-normal"><p className="text-sm">{clue.mapping.materialIds.length ? t('{count} 个正式物料', { count: clue.mapping.materialIds.length }) : t('尚未关联')}</p><p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{clue.mapping.materialIds.map(id => materials.get(id)?.tpInventoryCode || materials.get(id)?.erpCode).filter(Boolean).join('、')}</p></TableCell><TableCell className="text-xs">{t(mappingLabel(clue))}</TableCell><TableCell><div className="flex items-center gap-1"><Button asChild size="sm" variant="ghost"><Link to={href({ clue: clue.id })}>{t('查看详情')}</Link></Button><Button size="sm" variant="outline" onClick={() => onReview(clue)}>{t(data.canReview ? '核对料号' : '核对记录')}</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
    <KeyMaterialPagination {...page} onPage={value => change({ page: String(value) })} />
  </section>;
}
