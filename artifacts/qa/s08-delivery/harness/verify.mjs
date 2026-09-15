import assert from 'node:assert/strict';
const base='http://127.0.0.1:4186';
const headers={'X-QA-User':'qa-manager','X-Inogi-Fixture':'S08-memory-only'};
for(const path of ['/__qa/s08-delivery','/artifacts/qa/s08-delivery/harness/preview.tsx']){const r=await fetch(base+path);assert.equal(r.status,200);console.log('OK',path);}
let r=await fetch(base+'/api/procurement/delivery/schedule?month=2026-09&bucket=all',{headers});assert.equal(r.status,200);const schedule=await r.json();assert.equal(schedule.summary.all,27);assert.equal(schedule.rows.items.length,20);console.log('OK full mirror',schedule.summary);
r=await fetch(base+'/api/procurement/delivery/lines/qa-line-01?orderNo=QA-PO-001',{headers});assert.equal(r.status,200);const detail=await r.json();assert.equal(detail.supplier.originalDate,'2026-09-16');assert.equal(detail.erp.version,1);console.log('OK supplier + ERP history');
r=await fetch(base+'/api/procurement/tasks',{method:'POST',headers,body:'{}'});assert.equal(r.status,405);
r=await fetch(base+'/api/procurement/delivery/schedule?month=2026-09',{headers:{...headers,Authorization:'Bearer FAKE-QA-ONLY'}});assert.equal(r.status,403);console.log('OK unknown writes and Authorization rejected');
