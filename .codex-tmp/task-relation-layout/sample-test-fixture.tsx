import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SampleTestAssignmentDialog } from '/src/app/procurement/components/SampleTestAssignmentDialog';
import { ProcSampleTestDialog } from '/src/app/procurement/components/ProcSampleTestDialog';
import { MobileProcSampleTestPage } from '/src/app/MobileProcSampleTestPage';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router';
import '/src/styles/index.css';

const query = new URLSearchParams(location.search);
const task = { id: 'qa-sample-task', code: 'PROC-2026-QA-001', materialName: 'Q5 过滤盖板样品与尺寸复核', status: 'pending_sample', updatedAt: '2026-09-08T01:23:45.000Z', rdContactUserId: 'rd-user-001' };
const initialDetail = {
  task: { ...task, spec: '外形尺寸 80 × 60 mm，需验证密封及装配配合', quantity: 12, unit: '件', buyer: '采购负责人', status: 'testing', rdTaskTitle: '过滤组件 ECN 验证与装配可靠性测试', attachmentList: [] },
  sampleTest: { roundId: 'qa-round-20260908-003', testerUserId: 'rd-user-002', testerName: '李明', assignedAt: '2026-09-08T01:23:45.000Z', assignedByName: '采购负责人', result: null, note: null, confirmedAt: null, confirmedByName: null },
  canConfirm: true,
};
let writes = 0;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
// All application fetch requests stay in this fixture; no message, database or real API is touched.
window.fetch = async (input, init = {}) => {
  const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
  const method = init.method || 'GET';
  if (path === '/api/procurement/sample-testers') return json([
    { id: 'rd-user-001', name: '张工', department: '研发部' },
    { id: 'rd-user-002', name: '李明', department: '结构研发部' },
    { id: 'rd-user-003', name: '李明', department: '电子研发部' },
  ]);
  if (path === '/api/procurement/tasks/qa-sample-task/sample-test' && method === 'GET') {
    parent.postMessage({ kind: 'sample-request', request: { path, method } }, location.origin);
    return json(initialDetail);
  }
  if (path === '/api/procurement/tasks/qa-sample-task/sample-test/assign' || path === '/api/procurement/tasks/qa-sample-task/sample-test/confirm') {
    const payload = JSON.parse(String(init.body));
    parent.postMessage({ kind: 'sample-request', request: { path, method, payload, attempt: ++writes } }, location.origin);
    if (query.get('failure') === '1' && writes === 1) return json({ message: '模拟失败：任务版本已变化，请检查后重试' }, 409);
    if (path.endsWith('/assign')) return json({ ...task, status: 'testing', sampleTest: { ...initialDetail.sampleTest, testerUserId: payload.testerUserId } });
    return json({ ...initialDetail, canConfirm: false, sampleTest: { ...initialDetail.sampleTest, result: payload.result, note: payload.note, confirmedAt: '2026-09-08T06:07:08.000Z', confirmedByName: '李明（研发确认人）' } });
  }
  return json({ message: 'Fixture blocked an unrelated request' }, 418);
};
function Fixture() {
  const [closed, setClosed] = useState('');
  if (query.get('mode') === 'mobile-route') return <MemoryRouter initialEntries={['/rd-my-workspace?sampleTest=' + task.id]}><Routes><Route path="/rd-my-workspace" element={<MobileRouteFixture />} /><Route path="*" element={<p role="alert">误入其他路由</p>} /></Routes></MemoryRouter>;
  return closed ? <p role="status">{closed}</p> : query.get('mode') === 'confirm'
    ? <ProcSampleTestDialog taskId={task.id} onClose={() => setClosed('关闭成功')} onConfirmed={() => parent.postMessage({ kind: 'sample-result', result: '确认完成且采购已通知（模拟）' }, location.origin)} />
    : <SampleTestAssignmentDialog task={task} onClose={() => setClosed('取消成功')} onAssigned={(updated) => { setClosed('分派成功：' + updated.sampleTest.testerUserId); parent.postMessage({kind:'sample-result',result:'分派成功：'+updated.sampleTest.testerUserId}, location.origin); }} />;
}
function MobileRouteFixture() {
  const route = useLocation();
  const [params] = useSearchParams();
  return <><output data-testid="route-state" style={{ display: 'none' }}>{route.pathname + route.search}</output><MobileProcSampleTestPage taskId={params.get('sampleTest') || ''} /></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
setInterval(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (query.get('mode') === 'mobile-route') {
    parent.postMessage({ kind: 'sample-result', result: JSON.stringify({ route: document.querySelector('[data-testid="route-state"]')?.textContent, open: Boolean(dialog), mobileClass: document.documentElement.classList.contains('mobile-route'), bodyWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth }) }, location.origin);
  }
  if (!dialog) return;
  const rectangle = element => { const r = element.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }; };
  parent.postMessage({ kind: 'sample-layout', layout: { viewport: [innerWidth, innerHeight], dialog: rectangle(dialog), footer: rectangle(dialog.querySelector('[data-slot="dialog-footer"]')), scrollTop: dialog.scrollTop } }, location.origin);
}, 500);
