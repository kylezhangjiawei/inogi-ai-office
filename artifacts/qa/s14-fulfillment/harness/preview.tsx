import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, Outlet, useLocation, useNavigate } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth-preview';
import { PurchaseOrderDetail } from '../../../../src/app/order-processing/pages/PurchaseOrderDetail';
import '../../../../src/styles/index.css';
import '../../../../src/app/procurement/horizon.css';
import '../../../../src/app/order-processing/horizon.css';

const paths = { over: '/purchase-orders/QA-S14-OVER', mixed: '/purchase-orders/QA-S14-MIXED', empty: '/purchase-orders/QA-S14-EMPTY' };
function Frame() {
  const navigate = useNavigate();
  const current = useLocation();
  const [revision, setRevision] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const currentId = current.pathname.split('/').at(-1) || 'QA-S14-OVER';
  async function configure(orderError: boolean) {
    setBusy(true);
    try {
      const response = await fetch('/__qa/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderError }), credentials: 'omit' });
      if (!response.ok) throw new Error('夹具配置失败');
      setFailed(orderError);
      setNotice(orderError ? '已模拟当前订单读取失败。' : '读取已恢复，请点击产品页面的“重新加载”。');
      if (orderError) setRevision((value) => value + 1);
    } catch (error) { setNotice(error instanceof Error ? error.message : '夹具配置失败'); }
    finally { setBusy(false); }
  }
  const control = 'rounded-md border border-slate-500 px-3 py-2 text-left hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-white';
  return <div className="horizon-theme min-h-dvh min-w-0 bg-background">
    <div className="flex min-w-0 flex-wrap items-center gap-2 bg-slate-800 px-3 py-3 text-xs text-white" aria-label="S14 隔离验证控制台">
      <strong className="w-full">S14 订单履约 · 隔离只读验证</strong>
      <button className={control} onClick={() => navigate(paths.over)}>同单位超收抵欠</button>
      <button className={control} onClick={() => navigate(paths.mixed)}>混合单位与待核对</button>
      <button className={control} onClick={() => navigate(paths.empty)}>无明细</button>
      <button className={control} disabled={currentId === 'QA-S14-EMPTY'} onClick={() => navigate(`${current.pathname}?lineId=${encodeURIComponent(`${currentId}-line-1`)}`)}>定位第1行</button>
      <button className={control} disabled={busy || failed} onClick={() => void configure(true)}>模拟订单读取失败</button>
      <button className={control} disabled={busy || !failed} onClick={() => void configure(false)}>恢复读取</button>
      <span className="w-full leading-5 text-slate-300">本地内存数据；业务 API 写入被拒绝。上方入口是验证工具，以下为真实订单详情组件。</span>
      {notice ? <p className="w-full leading-5" role="status">{notice}</p> : null}
    </div>
    <main className="mx-auto min-w-0 max-w-[1600px] p-2 sm:p-4"><Outlet key={revision} /></main>
    <p className="break-all px-4 pb-4 text-xs text-slate-500" aria-label="验证路由">{current.pathname}{current.search}</p>
  </div>;
}
const requested = new URLSearchParams(location.search).get('view') as keyof typeof paths;
const initial = paths[requested] || paths.over;
const router = createMemoryRouter([{ element: <Frame />, children: [
  { path: '/purchase-orders/:id', element: <PurchaseOrderDetail /> },
  { path: '*', element: <p className="p-6">本夹具仅覆盖订单详情阅读，其他页面不执行操作。</p> },
] }], { initialEntries: [initial] });
createRoot(document.getElementById('root')!).render(<AuthProvider><RouterProvider router={router} /><Toaster /></AuthProvider>);
