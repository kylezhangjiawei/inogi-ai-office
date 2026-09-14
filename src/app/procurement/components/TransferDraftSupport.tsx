import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { clearTransferDraft, loadTransferDraft, saveTransferDraft, type TransferDraft, type TransferDraftSnapshot } from '../transferDraftStore';

export function TransferDraftSupport({ scope, snapshot, dirty, busy, restoreReady = true, onWritingChange, onRestore, onClose }: {
  scope: string; snapshot: TransferDraftSnapshot; dirty: boolean; busy: boolean;
  restoreReady?: boolean; onWritingChange?: (writing: boolean) => boolean; onRestore: (value: TransferDraftSnapshot) => void; onClose: () => void;
}) {
  const [saved, setSaved] = useState<TransferDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [savedSignature, setSavedSignature] = useState('');
  const alive = useRef(true);
  const lock = useRef(false);
  const latest = useRef(snapshot); latest.current = snapshot;
  const busyNow = useRef(busy); busyNow.current = busy;
  const signatureOf = (value: TransferDraftSnapshot) => JSON.stringify([value.form, value.files.map(row => [row.key, row.name, row.file?.lastModified, row.file?.size])]);
  const signature = signatureOf(snapshot);
  const persist = async () => {
    const savedSignature = signatureOf(latest.current);
    const value = await saveTransferDraft(scope, latest.current);
    if (alive.current) { setSaved(value); setSavedSignature(savedSignature); setAccepted(true); setError(''); }
    return savedSignature;
  };
  useEffect(() => {
    alive.current = true;
    void loadTransferDraft(scope).then(value => { if (alive.current) { setSaved(value); setLoaded(true); } })
      .catch(error => { if (alive.current) { setError(error.message); setLoadFailed(true); setLoaded(true); } });
    return () => { alive.current = false; };
  }, [scope]);
  useEffect(() => {
    if (!loaded || loadFailed || !dirty || busy || (saved && !accepted)) return;
    const timer = window.setTimeout(() => { void persist().catch(error => { if (alive.current) setError(error.message); }); }, 450);
    return () => window.clearTimeout(timer);
  }, [signature, loaded, loadFailed, dirty, busy, accepted, Boolean(saved)]);
  const blocked = useBlocker(dirty || busy || writing);
  useEffect(() => {
    if (!dirty && !busy && !writing) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, busy, writing]);
  const saveAndLeave = async (navigate: boolean) => {
    if (busyNow.current || lock.current || onWritingChange?.(true) === false) return;
    lock.current = true; setWriting(true);
    try {
      const savedSignature = await persist();
      if (!alive.current) return;
      if (busyNow.current) throw new Error('正在处理采购任务，请等待完成后再离开。');
      if (savedSignature !== signatureOf(latest.current)) throw new Error('保存期间填写内容有变化，请再次保存后离开。');
      if (navigate && blocked.state === 'blocked') blocked.proceed(); else onClose();
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '保存失败，请重试'); }
    finally { lock.current = false; onWritingChange?.(false); if (alive.current) setWriting(false); }
  };
  return <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
    <p>{saved && !accepted ? `发现本账号在此设备保存的草稿（${new Date(saved.savedAt).toLocaleString('zh-CN')}）。` : dirty && savedSignature === signature ? '已自动保存到此设备，重新打开本任务可恢复。' : '字段和新增附件可保存到此设备；草稿按账号、任务与工作区隔离。'}</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {saved && !accepted && <button type="button" disabled={busy || writing || !restoreReady} className="material-button-secondary px-3 py-2" onClick={() => setReplacing(true)}>恢复已保存草稿</button>}
      {(saved && !accepted || error) && <button type="button" disabled={busy || writing} className="material-button-secondary px-3 py-2" onClick={async () => {
        if (busyNow.current || lock.current || onWritingChange?.(true) === false) return;
        lock.current = true; setWriting(true);
        try { await clearTransferDraft(scope); if (alive.current) { setSaved(null); setAccepted(true); setLoadFailed(false); setError(''); } } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '清除失败'); }
        finally { lock.current = false; onWritingChange?.(false); if (alive.current) setWriting(false); }
      }}>清除旧草稿</button>}
      <button type="button" disabled={busy || writing || !loaded} className="material-button-secondary px-3 py-2" onClick={() => void saveAndLeave(false)}>{writing ? '正在保存…' : '保存草稿并关闭'}</button>
    </div>
    <AlertDialog open={replacing} onOpenChange={setReplacing}><AlertDialogContent aria-modal="true" className="horizon-theme horizon-portal proc-horizon-overlay">
      <AlertDialogHeader><AlertDialogTitle>恢复已保存的采购草稿？</AlertDialogTitle><AlertDialogDescription>恢复后替换当前填写内容。原研发附件会按当前可见资料重新核对；已移除或无权限的资料需要重新选择。</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>继续当前填写</AlertDialogCancel><AlertDialogAction onClick={() => { if (saved && !busy) { onRestore(saved); setAccepted(true); } }}>恢复草稿</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <AlertDialog open={blocked.state === 'blocked'} onOpenChange={open => { if (!open && blocked.state === 'blocked') blocked.reset(); }}><AlertDialogContent aria-modal="true" className="horizon-theme horizon-portal proc-horizon-overlay">
      <AlertDialogHeader><AlertDialogTitle>{busy ? '正在生成采购任务，请稍候' : '离开前保存采购草稿？'}</AlertDialogTitle><AlertDialogDescription>{busy ? '处理完成后再离开，避免重复提交。' : '可以先保存当前字段和新增附件，下次打开本任务时恢复。'}</AlertDialogDescription></AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={writing}>继续填写</AlertDialogCancel>{!busy && <AlertDialogAction disabled={writing} onClick={event => { event.preventDefault(); void saveAndLeave(true); }}>保存并离开</AlertDialogAction>}</AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
