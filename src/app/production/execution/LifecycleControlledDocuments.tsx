import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { AttachmentPreviewDialog, type PreviewableAttachment } from '../../components/AttachmentPreviewDialog';
import { getLifecycleDocument, type LifecycleDocument } from '../../lib/productionLifecycleApi';

const labels = { sop: 'SOP', sip: 'SIP', drawing: '图纸 / BOM' };
export function LifecycleControlledDocuments({ planId, documents, title = '受控文件', compact = false }: { planId: string; documents?: LifecycleDocument[]; title?: string; compact?: boolean }) {
  const [preview, setPreview] = useState<PreviewableAttachment | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setPreview(null); setError(''); setBusy(''); return () => request.current?.abort(); }, [planId, documents]);
  async function open(versionId: string) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(versionId); setError('');
    try { const file = await getLifecycleDocument(planId, versionId, controller.signal); if (!controller.signal.aborted) setPreview({ ...file, refresh: () => getLifecycleDocument(planId, versionId) }); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '文件读取失败'); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }
  return <section className={`production-surface${compact ? ' production-documents-compact' : ''}`}><div className="production-section-heading"><h3>{title}</h3></div>
    {!!documents?.length && <p className="px-4 pb-2 text-xs text-muted-foreground">下列日期为文件版本登记日期；资料包发布与 ECN 生效时间分别记录。</p>}
    {documents?.length ? <ul className="divide-y divide-border px-4">{documents.map(document => <li key={document.kind} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium">{labels[document.kind]} · {document.version}</p><p className="mt-1 break-words text-xs text-muted-foreground">{document.name}</p><p className="mt-1 text-xs text-muted-foreground">版本登记日期：{document.createdAt ? new Date(document.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '历史未记录'}</p></div><Button variant="outline" size="sm" disabled={busy === document.versionId} onClick={() => void open(document.versionId)}>{busy === document.versionId ? '正在读取…' : '查看固定版本'}</Button></li>)}</ul> : <p className="p-4 text-sm text-muted-foreground">历史资料尚未关联受控文件。文字依据保留，新正式发布需重新建立受控版本。</p>}
    {error && <p role="alert" className="px-4 pb-4 text-sm text-destructive">{error}</p>}
    {preview && <AttachmentPreviewDialog attachment={preview} onClose={() => setPreview(null)} />}
  </section>;
}
