import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../auth';
import { useI18n } from '../lib/i18n';
import { getMyOriginalRecords, type PersonalOriginalRecords as Result } from '../lib/relatedRecordsApi';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { Table, TableBody, TableHeader, TableHead, TableRow, TableCell } from '../components/ui/table';
const kinds: Record<string, string> = { production: '现场作业', quality: '质量协同 / 复验', ecn: 'ECN 阅读', 'ecn-feedback': 'ECN 执行反馈', sample: '样品测试', receiving: '采购收货', 'incoming-quality': '来料检验' };
export function PersonalOriginalRecords() {
  const { t } = useI18n(), { user } = useAuth();
  const scope = JSON.stringify([user?.id, [...(user?.permissions ?? [])].sort()]);
  const [snapshot, setSnapshot] = useState<{ scope: string; data?: Result; error?: string } | null>(null), [reload, setReload] = useState(0), [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [page, setPage] = useState(1);
  useEffect(() => { const controller = new AbortController(); setSnapshot(null); getMyOriginalRecords(controller.signal).then(data => { if (!controller.signal.aborted) setSnapshot({ scope, data }); }).catch(cause => { if (!controller.signal.aborted) setSnapshot({ scope, error: cause instanceof Error ? cause.message : '读取失败' }); }); return () => controller.abort(); }, [scope, reload]);
  const current = snapshot?.scope === scope ? snapshot : null, data = current?.data;
  const rows = data?.items.filter(row => (kind === 'all' || row.kind === kind) && `${row.title} ${row.code} ${row.state} ${row.detail}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 12)), selectedPage = Math.min(page, pages), today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return <section className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label={t('跨岗位待办')}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{t('跨岗位待办')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('仅汇集当前由我办理的原记录，包含跨月未完事项。办理结果以原模块为准。')}</p></div><Button variant="outline" disabled={!current} onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" />{t('重新加载')}</Button></header>
    {!current ? <p role="status" className="py-12 text-center text-muted-foreground">{t('正在读取本人待办…')}</p> : current.error ? <p role="alert" className="p-4 text-destructive">{current.error}</p> : <>
      {data?.errors.map(error => <p key={error} role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>)}
      <div className="flex flex-wrap gap-2"><Input className="min-w-48 flex-1" aria-label={t('搜索跨岗位待办')} placeholder={t('搜索原编号、任务或待补资料')} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /><NativeSelect className="w-48" aria-label={t('待办业务类型')} value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}><option value="all">{t('全部业务类型')}</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</NativeSelect></div>
      <Table containerClassName="max-h-[min(60dvh,42rem)] overflow-auto" className="min-w-[740px]"><TableHeader className="sticky top-0 bg-card"><TableRow>{['原任务 / 编号', '业务', '当前待办', '期限', '资料 / 验证安排', '操作'].map(label => <TableHead key={label}>{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice((selectedPage - 1) * 12, selectedPage * 12).map(row => <TableRow key={row.kind + row.id}><TableCell className="max-w-72 whitespace-normal font-medium">{row.title}<p className="mt-1 text-xs font-normal text-muted-foreground">{row.code}</p></TableCell><TableCell className="text-xs">{t(kinds[row.kind] ?? row.kind)}</TableCell><TableCell className="text-xs">{t(row.state)}<p className="mt-1 text-muted-foreground">{row.owner}</p></TableCell><TableCell className={row.dueDate && row.dueDate < today ? 'text-destructive' : ''}>{row.dueDate || t('待确认')}</TableCell><TableCell className="max-w-80 whitespace-normal text-xs leading-5 text-muted-foreground">{row.detail || '—'}</TableCell><TableCell><Button variant="outline" size="sm" asChild><Link to={row.href}>{t('进入原记录')}</Link></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">{t(data?.errors.length ? '部分来源读取失败，暂未取得匹配记录' : '当前没有匹配的本人待办')}</TableCell></TableRow>}</TableBody></Table>
      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>{rows.length} {t('项')} · {selectedPage} / {pages} · {t('读取时间')} {data?.readAt ? new Date(data.readAt).toLocaleTimeString() : '—'}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={selectedPage === 1} onClick={() => setPage(selectedPage - 1)}>{t('上一页')}</Button><Button variant="outline" size="sm" disabled={selectedPage === pages} onClick={() => setPage(selectedPage + 1)}>{t('下一页')}</Button></div></footer>
    </>}
  </section>;
}
