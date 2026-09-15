import React from 'react';
import { useWorkspaceModalLayer, workspaceLayerProvenance } from 'virtual:s02-workspace-modal-layer';
import { initialTasks } from './fixtures.mjs';
import { TransferToProcurementModal, useProcurementTaskLink } from '../../../../src/app/procurement/components/rdInsertion';
import type { ProcurementTask } from '../../../../src/app/lib/procurementApi';

/** Fixture markup only. Focus, background inertness, scroll and keyboard policy use the exact production hook. */
export function NestedWorkspaceFixture({ lateLink, onClose, onTransferred }: {
  lateLink: boolean; onClose: () => void; onTransferred: (task: ProcurementTask) => void;
}) {
  const surfaceRef = React.useRef<HTMLElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferCloseCount, setTransferCloseCount] = React.useState(0);
  const [note, setNote] = React.useState('父抽屉草稿：嵌套确认取消后应保留');
  useWorkspaceModalLayer(surfaceRef, closeButtonRef, onClose);
  const { task: linkedTask, loading: linkedLoading } = useProcurementTaskLink(lateLink && transferOpen ? initialTasks.fresh.taskId : undefined);
  const blockingTask = linkedTask && linkedTask.status !== 'cancelled' ? linkedTask : null;
  const buttonClass = 'min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-600';
  return <>
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20" data-s02-workspace-fixture="backdrop">
      <aside ref={surfaceRef} role="dialog" aria-modal="true" aria-labelledby="qa-workspace-drawer-title" tabIndex={-1}
        className="horizon-theme flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl" data-s02-workspace-fixture="parent">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div className="min-w-0"><h2 id="qa-workspace-drawer-title" className="text-base font-semibold text-slate-900">工作台嵌套弹窗验证</h2><p className="mt-1 text-xs leading-5 text-slate-500">真实 useWorkspaceModalLayer + 真实转采购弹窗；父抽屉业务内容为夹具。</p></div>
          <button ref={closeButtonRef} type="button" className={buttonClass} onClick={onClose}>关闭父抽屉</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <label className="grid gap-2 text-sm text-slate-600">父抽屉备注<textarea className="min-h-24 rounded-lg border border-slate-200 p-3" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className="material-button-primary mt-5 min-h-11 px-4 py-2 text-sm" onClick={() => setTransferOpen(true)}>{lateLink ? '打开转采购 · 2 秒后出现既有关联' : '打开转采购'}</button>
          <div className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600" aria-label="父抽屉挂载状态">
            <p>父抽屉保持挂载；转采购关闭次数：<strong>{transferCloseCount}</strong></p>
            <p>转采购挂载：<strong>{transferOpen ? '是' : '否'}</strong></p>
            <p>晚到关联：<strong>{blockingTask ? `${blockingTask.code} · 已传 blockingTask` : linkedLoading ? '读取中（本地 2 秒延迟）' : lateLink ? '打开转采购后开始读取' : '本模式未启用'}</strong></p>
          </div>
          <p className="mt-4 break-all text-xs leading-5 text-slate-400">父层算法原样提取自 {workspaceLayerProvenance.path}:{workspaceLayerProvenance.startLine}–{workspaceLayerProvenance.endLine} · SHA-256 {workspaceLayerProvenance.sha256.slice(0, 12)}</p>
          <p className="mt-3 text-xs leading-5 text-slate-500">修改子表单后尝试关闭，再在放弃确认中按 Tab、Shift+Tab 和 Escape。父抽屉与其备注应继续保留。</p>
        </div>
      </aside>
    </div>
    {transferOpen ? <TransferToProcurementModal {...initialTasks.fresh} blockingTask={blockingTask} onTransferred={onTransferred}
      onClose={() => { setTransferOpen(false); setTransferCloseCount((count) => count + 1); }} /> : null}
  </>;
}
