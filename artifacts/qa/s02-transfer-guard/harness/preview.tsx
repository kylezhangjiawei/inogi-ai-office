import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth-preview';
import { initialTasks, resubmitFrom } from './fixtures.mjs';
import { NestedWorkspaceFixture } from './NestedWorkspaceFixture';
import { TransferToProcurementModal } from '../../../../src/app/procurement/components/rdInsertion';
import type { ProcurementTask } from '../../../../src/app/lib/procurementApi';
import '../../../../src/styles/index.css';
import '../../../../src/app/procurement/horizon.css';

type Mode = 'success' | 'error' | 'error-once' | 'slow';
function Preview() {
  const [open, setOpen] = React.useState<'fresh' | 'resubmit' | null>(null);
  const [result, setResult] = React.useState<ProcurementTask | null>(null);
  const [transferMode, setTransferMode] = React.useState<Mode>('success');
  const [uploadMode, setUploadMode] = React.useState<Mode>('success');
  const [documentsMode, setDocumentsMode] = React.useState<Mode>('success');
  const [busy, setBusy] = React.useState(false);
  const openingRef = React.useRef(false);
  const [stats, setStats] = React.useState<Record<string, number>>({});
  const [notice, setNotice] = React.useState('');
  const [nestedOpen, setNestedOpen] = React.useState(false);
  const [lateLink, setLateLink] = React.useState(false);
  const [parentCloseCount, setParentCloseCount] = React.useState(0);
  const loadStats = React.useCallback(async () => {
    const response = await fetch('/__qa/health', { credentials: 'omit' });
    if (response.ok) { const data = await response.json(); setStats(data.counts); }
  }, []);
  React.useEffect(() => { void loadStats(); const timer = window.setInterval(() => void loadStats(), 1000); return () => window.clearInterval(timer); }, [loadStats]);
  async function openModal(kind: 'fresh' | 'resubmit' | 'nested') {
    if (openingRef.current) return;
    openingRef.current = true;
    setBusy(true);
    try {
      const response = await fetch('/__qa/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transferMode, uploadMode, documentsMode }), credentials: 'omit' });
      if (!response.ok) throw new Error('隔离配置失败');
      setResult(null); setNotice('');
      if (kind === 'nested') setNestedOpen(true);
      else setOpen(kind);
    } catch (error) { setNotice(error instanceof Error ? error.message : '隔离配置失败'); }
    finally { openingRef.current = false; setBusy(false); }
  }
  async function resetCounts() {
    const response = await fetch('/__qa/reset-counts', { method: 'POST', credentials: 'omit' });
    if (response.ok) { await loadStats(); setNotice('本地调用计数已清零。'); }
  }
  const modes: Array<[Mode, string]> = [['success', '正常成功'], ['error-once', '一次失败后可重试'], ['slow', '延迟 3 秒成功'], ['error', '持续失败']];
  const control = 'min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600';
  const initial = open ? initialTasks[open] : null;
  return <main className="horizon-theme min-h-dvh min-w-0 bg-background px-4 py-6 sm:px-8">
    <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <p className="text-xs font-semibold text-blue-700">S02 · 转采购表单保护 · 隔离验证</p>
      <h1 className="mt-2 text-xl font-bold text-slate-900">研发需求转采购</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">下面打开真实转采购弹窗；研发附件、产品和采购结果均为本地测试资料。提交与上传只记录在本进程内存，不写真实业务、不发通知。</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {([['提交结果', transferMode, setTransferMode], ['新增附件上传', uploadMode, setUploadMode], ['技术资料读取', documentsMode, setDocumentsMode]] as const).map(([label, value, setter]) => <label className="grid gap-1 text-xs text-slate-500" key={label}>{label}<select className={control} value={value} onChange={(event) => setter(event.target.value as Mode)} disabled={busy}>{modes.map(([mode, text]) => <option key={mode} value={mode}>{text}</option>)}</select></label>)}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button className="material-button-primary min-h-11 px-5 py-2 text-sm" aria-disabled={busy} onClick={() => void openModal('fresh')}>转采购</button>
        <button className={control} aria-disabled={busy} onClick={() => void openModal('resubmit')}>重新提交既有需求</button>
        <button className={control} disabled={busy} onClick={() => void resetCounts()}>清零本地计数</button>
        <button className={control} aria-disabled={busy} onClick={() => void openModal('nested')}>工作台嵌套弹窗验证</button>
      </div>
      <label className="mt-4 flex min-h-10 items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={lateLink} onChange={(event) => setLateLink(event.target.checked)} />嵌套模式：打开转采购后 2 秒出现既有关联</label>
      <p className="mt-2 text-xs text-slate-500" aria-label="父抽屉关闭计数">父抽屉关闭次数：{parentCloseCount}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-4" aria-label="本地调用计数">
        {([['submit', '转采购调用'], ['upload', '上传申请'], ['put', '上传 PUT'], ['register', '文件登记']] as const).map(([key, label]) => <div key={key}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{stats[key] ?? 0}</dd></div>)}
      </dl>
      <p className="mt-3 text-xs leading-5 text-slate-500">一次失败模式在首次请求返回错误后自动恢复，直接在弹窗内重试。持续失败可关闭弹窗后切回正常；延迟模式便于核对提交锁与重复点击。</p>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-blue-700"><a href="/__qa/files/drawing.pdf" download="阀体结构图-QA.pdf">下载本地 PDF 测试附件</a><a href="/__qa/files/notes.txt" download="测试说明-QA.txt">下载本地文本测试附件</a><a href="/__qa/health" target="_blank" rel="noreferrer">查看本地请求记录</a></div>
      {notice ? <p role="status" className="mt-4 text-sm text-slate-600">{notice}</p> : null}
      {result ? <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><strong>本地模拟已收到：{result.code}</strong><p className="mt-2">{result.materialName} · {result.quantity} {result.unit} · {result.attachments} 份附件</p><p className="mt-1 text-xs">未保存到真实业务，也未通知采购负责人。</p></div> : null}
    </section>
    {initial ? <TransferToProcurementModal key={open} {...initial} resubmitFrom={open === 'resubmit' ? resubmitFrom as ProcurementTask : null} onTransferred={(task) => { setResult(task); void loadStats(); }} onClose={() => { setOpen(null); void loadStats(); }} /> : null}
    {nestedOpen ? <NestedWorkspaceFixture lateLink={lateLink} onClose={() => { setNestedOpen(false); setParentCloseCount((count) => count + 1); }} onTransferred={(task) => { setResult(task); void loadStats(); }} /> : null}
  </main>;
}
const router = createMemoryRouter([{ path: '*', element: <Preview /> }], { initialEntries: ['/rd-my-workspace'] });
createRoot(document.getElementById('root')!).render(<AuthProvider><RouterProvider router={router} /><Toaster /></AuthProvider>);
