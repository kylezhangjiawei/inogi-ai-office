import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider,Outlet,useLocation,useNavigate} from 'react-router';
import {AuthProvider} from './auth-preview';
import {ProcMyWorkspacePage} from '../../../../src/app/procurement/ProcMyWorkspacePage';
import {ProcPeopleManagementPage} from '../../../../src/app/procurement/ProcPeopleManagementPage';
import {ProcurementCockpitPage} from '../../../../src/app/procurement/ProcurementCockpitPage';
import {PurchaseOrderDetail} from '../../../../src/app/order-processing/pages/PurchaseOrderDetail';
import {refreshProcurement} from '../../../../src/app/procurement/data';
import {PriceHistoryModal} from '../../../../src/app/procurement/components/PriceHistoryModal';
import {Toaster} from 'sonner';
import '../../../../src/styles/index.css';
import '../../../../src/app/procurement/horizon.css';
import '../../../../src/app/order-processing/horizon.css';
function Frame(){const navigate=useNavigate();const current=useLocation();const [failures,setFailures]=React.useState<Record<string,boolean>>({}); async function flip(key:string){const value=!failures[key];await fetch('/__qa/fail',{method:'POST',body:JSON.stringify({[key]:value})});setFailures({...failures,[key]:value});if(key==='tasks') await refreshProcurement();}return <div className="horizon-theme min-h-dvh bg-background">
<div className="flex flex-wrap items-center gap-3 bg-slate-800 px-4 py-3 text-xs text-white"><strong>样品时间与采购条件 · 隔离验证 · 不访问实际业务数据</strong><button onClick={()=>navigate('/proc-my-workspace?month=2026-09&period=all')}>采购工作台</button><button onClick={()=>navigate('/proc-cockpit?tab=samples&sample=CURRENT')}>样品协同</button><button onClick={()=>navigate('/price-check')}>历史报价</button><button onClick={()=>navigate('/purchase-orders/QA-PO-20260910?lineId=qa-date-line-2')}>订单详情</button>{['sample','quotes','tasks'].map(key=><button key={key} onClick={()=>flip(key)}>{failures[key]?'恢复':'模拟失败'} {key}</button>)}<a href="?access=noaudit&view=order">无审计权限</a><a href="?access=rd&view=order">仅研发管理权限</a><a href="?access=noplan">无备货权限</a><a href="?access=manager">恢复权限</a></div>
<main className="mx-auto max-w-[1600px] p-4"><Outlet/></main><p className="break-all px-4 pb-4 text-xs" aria-label="验证路由">{current.pathname}{current.search}</p></div>}
function PriceCheck(){const [mode,setMode]=React.useState<'exact'|'candidate'|null>(null);return <section className="flex flex-wrap gap-3"><h1 className="w-full text-xl font-semibold">历史报价范围验证</h1><button onClick={()=>setMode('exact')}>正式物料报价</button><button onClick={()=>setMode('candidate')}>同名候选报价</button><PriceHistoryModal open={mode!==null} materialId={mode==='exact'?'qa-material-a':null} materialName="阀体（隔离验证）" onClose={()=>setMode(null)}/></section>}
const initial='/proc-cockpit?tab=samples&sample=CURRENT';
const router=createMemoryRouter([{element:<Frame/>,children:[{path:'/proc-my-workspace',element:<ProcMyWorkspacePage/>},{path:'/purchase-orders/:id',element:<PurchaseOrderDetail/>},{path:'/price-check',element:<PriceCheck/>},{path:'/proc-people-management',element:<ProcPeopleManagementPage/>},{path:'/proc-cockpit',element:<ProcurementCockpitPage/>},{path:'*',element:<p>仅验证导航入口，目标模块不执行操作。</p>}]}],{initialEntries:[initial]});
createRoot(document.getElementById('root')!).render(<AuthProvider><RouterProvider router={router}/><Toaster/></AuthProvider>);
