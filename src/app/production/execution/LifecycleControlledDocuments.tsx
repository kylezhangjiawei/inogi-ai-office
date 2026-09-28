import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { AttachmentPreviewDialog, type PreviewableAttachment } from '../../components/AttachmentPreviewDialog';
import { getLifecycleDocument, type LifecycleDocument } from '../../lib/productionLifecycleApi';

const labels = { sop: 'SOP', sip: 'SIP', drawing: '图纸 / BOM' };
export function LifecycleControlledDocuments({ planId, documents, title = '受控文件' }: { planId: string; documents?: LifecycleDocument[]; title?: string }) {
  const [preview, setPreview] = useState<PreviewableAttachment | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setPreview(null); setError(''); setBusy(''); return () => request.current?.abort(); }, [planId, documents]);
  async function open(versionId: string) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(versionId); setError('');
    try { const file = await getLifecycleDocument(planId, versionId, controller.signal); if (!controller.signal.aborted) setPreview({ ...file, refresh: () => getLifecycleDocument(planId, versionId) }); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '文件读取失败'); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }
  return <section className="production-surface"><div className="production-section-heading"><h3>{title}</h3></div>
    {documents?.length ? <ul className="divide-y divide-border px-4">{documents.map(document => <li key={document.kind} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium">{labels[document.kind]} · {document.version}</p><p className="mt-1 break-words text-xs text-muted-foreground">{document.name}</p></div><Button variant="outline" size="sm" disabled={busy === document.versionId} onClick={() => void open(document.versionId)}>{busy === document.versionId ? '正在读取…' : '查看固定版本'}</Button></li>)}</ul> : <p className="p-4 text-sm text-muted-foreground">历史资料尚未关联受控文件。文字依据保留，新正式发布需重新建立受控版本。</p>}
    {error && <p role="alert" className="px-4 pb-4 text-sm text-destructive">{error}</p>}
    {preview && <AttachmentPreviewDialog attachment={preview} onClose={() => setPreview(null)} />}
  </section>;
}
