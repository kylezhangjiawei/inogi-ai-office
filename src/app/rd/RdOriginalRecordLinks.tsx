import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth';
import { useI18n } from '../lib/i18n';
import { Button } from '../components/ui/button';
import { getRdOriginalRecords, type OriginalRecordItem } from '../lib/relatedRecordsApi';
export function RdOriginalRecordLinks({ rdTaskId }: { rdTaskId: string }) {
  const { user } = useAuth(), { t } = useI18n();
  const scope = JSON.stringify([rdTaskId, user?.id, [...(user?.permissions ?? [])].sort()]);
  const [snapshot, setSnapshot] = useState<{ scope: string; items?: OriginalRecordItem[]; error?: string } | null>(null), [reload, setReload] = useState(0);
  useEffect(() => { const controller = new AbortController(); setSnapshot(null); getRdOriginalRecords(rdTaskId, controller.signal).then(value => { if (!controller.signal.aborted) setSnapshot({ scope, items: value.items }); }).catch(cause => { if (!controller.signal.aborted) setSnapshot({ scope, error: cause instanceof Error ? cause.message : '读取失败' }); }); return () => controller.abort(); }, [scope, rdTaskId, reload]);
  const current = snapshot?.scope === scope ? snapshot : null;
  if (!current) return <p role="status" className="text-xs text-muted-foreground">{t('正在核对相关原记录…')}</p>;
  if (current.error) return <div role="alert" className="text-sm text-destructive">{current.error}<Button variant="link" onClick={() => setReload(value => value + 1)}>{t('重试关联记录')}</Button></div>;
  if (!current.items?.length) return null;
  return <section className="space-y-3" aria-label={t('相关原记录')}><h3 className="text-sm font-semibold">{t('相关原记录')}</h3><ul className="divide-y divide-border">{current.items.map(row => <li key={row.kind + row.id} className="flex items-start justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="break-words font-medium">{row.code} · {row.title}</p><p className="mt-1 text-xs text-muted-foreground">{t(row.state)}</p></div><Button asChild size="sm" variant="outline"><Link to={row.href}>{t('查看原记录')}</Link></Button></li>)}</ul></section>;
}
