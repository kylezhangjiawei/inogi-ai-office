import React from 'react';
import { createRoot } from 'react-dom/client';
import { PurchaseFulfillmentDrawer } from '../../../../src/app/order-processing/components/PurchaseFulfillmentDrawer';
import { SampleRecordsPanel } from '../../../../src/app/procurement/samples/SampleRecordsPanel';
import { SampleRoundHistory } from '../../../../src/app/procurement/samples/SampleRoundHistory';
import { SampleTimingSummary } from '../../../../src/app/procurement/samples/SampleTimingSummary';
import { getSampleDetail, setScenario } from './api';
import '../../../../src/styles/index.css';
import '../../../../src/app/procurement/horizon.css';
const ignoreInteraction = () => {};
function Preview() {
  const [open, setOpen] = React.useState(false), [revision, setRevision] = React.useState(0), [detail, setDetail] = React.useState(getSampleDetail), [mode, setMode] = React.useState('success');
  const change = (next: string) => { setScenario(next); setMode(next); setRevision((n) => n + 1); setDetail(getSampleDetail()); };
  return <div className="horizon-theme min-h-dvh bg-slate-100 p-3 sm:p-6"><header className="mx-auto mb-5 max-w-5xl space-y-3 rounded-xl bg-slate-800 p-4 text-sm text-white"><p>隔离预览 · S14 履约 / S03 轮次登记 · 固定内存数据，不访问实际业务</p><div className="flex flex-wrap gap-2">{[['success', '成功保存'], ['conflict', '版本冲突'], ['readonly', '只读']].map(([value, label]) => <button key={value} aria-pressed={mode === value} className="rounded border px-3 py-2" onClick={() => change(value)}>{label}</button>)}<button className="rounded border px-3 py-2" onClick={() => setOpen(true)}>打开 S14 履约台账</button></div><p>当前：{mode}。切换场景会重置本地夹具。</p></header>
    <main key={`sample-${revision}`} className="mx-auto max-w-5xl space-y-4"><h1 className="text-lg font-semibold">S03 · 真实样品登记与轮次组件</h1><SampleTimingSummary detail={detail}/><SampleRecordsPanel detail={detail} identity="qa-user" onSaved={setDetail} onReload={() => setDetail(getSampleDetail())} onInteractionStateChange={ignoreInteraction}/><SampleRoundHistory detail={detail}/></main>
    {open && <PurchaseFulfillmentDrawer key={`fulfillment-${revision}`} lineId="qa-line-1" onClose={() => setOpen(false)} />}</div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
