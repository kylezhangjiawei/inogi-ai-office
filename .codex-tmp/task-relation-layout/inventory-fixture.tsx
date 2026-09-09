import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { InventoryReadinessPage } from './inventory-page';
import { StockPlanPanel } from '/src/app/procurement/components/StockPlanPanel';
import { calculateInventoryReadiness } from '/apps/api/src/modules/procurement/inventory-readiness';
import { buildInventoryMatchDiagnostics } from '/apps/api/src/modules/procurement/inventory-match-diagnostic';
import '/src/styles/index.css';

const staleFixture = new URLSearchParams(location.search).get('stale') === '1';
const editingFixture = new URLSearchParams(location.search).get('edit') === '1';
const defaultModel = new URLSearchParams(location.search).get('model') === 'common' ? '通用' : 'Q5';
const oldRows = staleFixture ? Array.from({ length: 35 }, (_, index) => ['OLD-' + String(index + 1).padStart(3, '0'), '需要核对写入时间的过滤组件及生产装配固定材料 ' + (index + 1), 1]) : [];
const leaves = [
  ['MISSING', '无物料档案', 1], ['NO-STOCK', '物料档案存在但无库存', 1],
  ['OTHER', '其他仓库存长名称', 1], ['ZERO', '真实量产仓零库存', 1],
  ['NO-QTY', '无单机用量且无库存', null],
  ...oldRows,
].map(([code, name, qtyPer]) => ({ id: code, code, name, qtyPer, category: '测试组件', spec: '', unit: '件' }));
if (editingFixture) Object.assign(leaves[0], {code:null,name:'模拟缺编码组件'});
const warehouses = ['研发样品试制及长期可靠性测试临时专用仓库（北京昌平测试中心东侧区域）', 'OVERSEAS_WAREHOUSE_FOR_LONG_TERM_ASSEMBLY_RELIABILITY_AND_PACKAGING_VALIDATION_REFERENCE_ONLY', '售后配件仓'];
const materials = leaves.filter(leaf => leaf.code !== 'MISSING').map(leaf => ({ tpInventoryCode: leaf.code }));
const snapshots = [{ tpInventoryCode: 'ZERO', warehouse: '量产仓库' }, ...oldRows.map(([code]) => ({tpInventoryCode:code,warehouse:'量产仓库'})), ...warehouses.map(warehouse => ({ tpInventoryCode: 'OTHER', warehouse }))];
const olderTime = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
const balance = [{ code: 'ZERO', stock: 0, available: 0, inTransit: 0, safeStock: 0, syncedAt: staleFixture ? olderTime : '2026-09-08T02:00:00.000Z' }, ...oldRows.map(([code]) => ({code,stock:10,available:10,inTransit:0,safeStock:0,syncedAt:olderTime}))];
const getResponse = (model = defaultModel, target = 100) => {
  const diagnostics = buildInventoryMatchDiagnostics(leaves.map(leaf => leaf.code).filter(Boolean), materials, snapshots);
  const sources = leaves.map(leaf => ({...leaf, bomPosition:'模拟装配组', sourceLines:[{id:leaf.id,name:leaf.name,code:leaf.code,qtyPer:leaf.qtyPer,remark:leaf.spec,parentId:leaf.parentId || 'fixed-group',category:leaf.category,bomPosition:'模拟装配组',unit:'件',updatedAt:leaf.updatedAt || '2026-09-08T02:00:00.000Z'}]}));
  const calculation = calculateInventoryReadiness(sources, balance, target);
  const response = { source: 'tplus', readOnly: true, productLine: model, models: [{ id: 'Q5', label: 'Q5', bomLines: leaves.length },{id:'通用',label:'通用',bomLines:leaves.length}], bomPositions:[{id:'fixed-group',name:'模拟装配组'},{id:'other-group',name:'模拟其他位置'}], warehouse: { keyword: '量产', label: '量产仓库', matchedNames: ['量产仓库'] }, syncedAt: '2026-09-08T02:00:00.000Z', ...calculation, items: calculation.items.map(item => ({ ...item, inventoryDiagnostic: diagnostics.get(item.code) })), packaging: model === 'Q5' ? { sourceFile: '包材表', sourceSheet: '包材', items: [{ id: 'package-other', sourceRow: 2, code: 'OTHER', name: '其他仓包材参考', unit: '件', qtyPer: null, stock: null, available: null, inTransit: null, syncedAt: null, issue: 'inventory_unmatched', duplicateOfRow: null, inventoryDiagnostic: diagnostics.get('OTHER') }] } : undefined };
  if (staleFixture && response.packaging) response.packaging.items.push({ id:'duplicate-zero',sourceRow:3,code:'ZERO',name:'同编码包材重复参考',unit:'件',qtyPer:1,stock:0,available:0,inTransit:0,syncedAt:olderTime,issue:null,duplicateOfRow:null });
  return response;
};
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  if (editingFixture && init.method === 'PUT' && url.pathname.startsWith('/api/procurement/inventory-readiness/bom-lines/')) {
    const id=decodeURIComponent(url.pathname.split('/').at(-1)); const payload=JSON.parse(String(init.body));
    const leaf=leaves.find(leaf=>leaf.id===id);
    if(!leaf) return json({message:'模拟源行不存在'},404);
    Object.assign(leaf,{code:payload.code,name:payload.name,qtyPer:payload.qtyPer,spec:payload.remark,updatedAt:'2026-09-08T04:00:00.000Z',...(payload.parentId ? {parentId:payload.parentId}: {})});
    parent.postMessage({kind:'inventory-write',request:{id,method:init.method,payload}},location.origin);
    document.documentElement.dataset.lastInventoryWrite=JSON.stringify({id,method:init.method,payload});
    return json({id,updatedAt:leaf.updatedAt});
  }
  if (url.pathname === '/api/procurement/inventory-readiness/material' && (!init.method || init.method==='GET')) return json({matched:true,category:'模拟主档分类',unit:url.searchParams.get('code')==='NO-QTY'?'kg':'件'});
  if ((!init.method || init.method === 'GET') && url.pathname === '/api/procurement/stock-plans') return new Response(JSON.stringify({items:[]}), {headers:{'content-type':'application/json'}});
  if ((!init.method || init.method === 'GET') && url.pathname.endsWith('/products')) return new Response(JSON.stringify([]), {headers:{'content-type':'application/json'}});
  const ok = url.pathname === '/api/procurement/inventory-readiness' && (!init.method || init.method === 'GET');
  return new Response(JSON.stringify(ok ? getResponse(url.searchParams.get('productLine') || defaultModel, Number(url.searchParams.get('targetSets') || 100)) : { message: 'Fixture blocked an unrelated request' }), { status: ok ? 200 : 418, headers: { 'content-type': 'application/json' } });
};
function RouteState() { const route=useLocation(); return <output id="inventory-route" style={{display:'none'}}>{route.pathname+route.search}</output>; }
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/proc-inventory-readiness?productLine='+defaultModel]}><RouteState /><Routes><Route path="/proc-inventory-readiness" element={<InventoryReadinessPage />} /><Route path="/proc-cockpit" element={<StockPlanPanel materials={[]} canCreate />} /></Routes></MemoryRouter>);
