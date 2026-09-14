import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/production/inspections/inspectionModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('检验演示不能访问接口、库存或持久化'); }; const storage = new Proxy({}, { get: forbidden, set: forbidden }); const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, forbidden, storage, storage, storage);
const { createInspectionState, inspectionToday, canOperateInspection, getInspectionProgress, getReinspectable, getTransferable, validateInspectionAction, applyInspectionAction, buildInspectionCsv } = model;
const now = '2026-09-11T05:00:00.000Z'; const today = '2026-09-11';
const task = (state, id = 'task-final') => state.tasks.find((item) => item.id === id);
const progress = (state, id = 'task-final') => getInspectionProgress(state, id);
const accept = (patch = {}) => ({ kind: 'accept', actorId: 'qc-a', taskId: 'task-pending', reviewed: true, ...patch });
const inspect = (patch = {}) => ({ kind: 'inspect', actorId: 'qc-a', taskId: 'task-pending', date: today, quantity: 10, good: 9, bad: 1, note: '独立初检', evidence: '按SIP核对量测与功能读数', photos: [], reviewed: true, ...patch });
const reinspect = (patch = {}) => ({ ...inspect(), kind: 'reinspect', taskId: 'task-final', issueId: 'issue-ready', quantity: 2, good: 2, bad: 0, ...patch });
const transfer = (patch = {}) => ({ kind: 'transfer', actorId: 'qc-a', taskId: 'task-process', recordId: 'record-process', phenomenon: '装配干涉', description: '', reviewed: true, ...patch });
const release = (patch = {}) => ({ kind: 'release', actorId: 'qa-a', taskId: 'task-release', quantity: 4, basis: 'QA-APPROVAL-0911 授权放行记录', note: '核对任务范围后分批授权', reviewed: true, ...patch });
const act = (state, action, version = state.version, time = now) => applyInspectionAction(state, version, action, time);
const errors = (state, action, day = today) => validateInspectionAction(state, action, day);
const accepted = () => act(createInspectionState(), accept());
const freeze = (value) => { Object.freeze(value); for (const entry of Object.values(value)) if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) freeze(entry); return value; };
const photo = (patch = {}) => ({ id: 'photo-1', name: '检验.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', ...patch });
function parseCsv(csv) { const rows = []; let row = []; let field = ''; let quoted = false; const text = csv.replace(/^\uFEFF/, ''); for (let i = 0; i < text.length; i++) { const char = text[i]; if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; } else if (char === '"') quoted = true; else if (char === ',') { row.push(field); field = ''; } else if (char === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; } else field += char; } return rows; }

test('默认首次、复验、未解决不良与QA放行各自独立，首次率按百分数', () => {
  const state = createInspectionState();
  assert.deepEqual(progress(state), { initial: 50, firstGood: 47, firstBad: 3, firstPassRate: 94, uninspected: 0, retested: 0, retestGood: 0, retestBad: 0, unresolved: 3, qualified: 47, released: 0, releasable: 0 });
  assert.equal(getReinspectable(state, 'issue-ready'), 2); assert.equal(getTransferable(state, 'record-initial'), 0); assert.equal(getTransferable(state, 'record-process'), 6);
  assert.equal(progress(state, 'task-pending').firstPassRate, null); assert.equal(progress(state, 'task-release').releasable, 10);
});

test('历史P09快照保持首次110/116、复验6、累计116和独立放行100', () => {
  const state = createInspectionState(); const historical = progress(state, 'task-closed');
  assert.equal(task(state, 'task-closed').archiveId, 'batch-02'); assert.equal(historical.firstGood, 110); assert.equal(historical.firstBad, 6);
  assert.equal(historical.retested, 6); assert.equal(historical.qualified, 116); assert.equal(historical.released, 100); assert.equal(historical.unresolved, 0);
  assert.equal(historical.releasable, 0, '结案只读任务没有当前可记录放行量，原未授权16台事实仍保留');
  assert.equal(historical.qualified - historical.released, 16);
  const historySip = task(state, 'task-closed').documents[0];
  assert.equal(historySip.code, 'SIP-FINAL'); assert.equal(historySip.version, 'C'); assert.match(historySip.summary, /历史原件尚未接入/);
  for (const record of state.records.filter((item) => item.taskId === 'task-closed')) { assert.equal(record.sipCode, historySip.code); assert.equal(record.sipVersion, 'C'); }
  assert.equal(task(state).documents[0].version, 'V1.0'); assert.equal(state.records[0].sipVersion, 'V1.0');
  assert.ok(Math.abs(historical.firstPassRate - 110 / 116 * 100) < 1e-10);
  for (const code of ['FQC-0907-02', 'NCR-0907-02', 'RETEST-0907-02', 'QA-REL-0907-02']) assert.ok([...state.records, ...state.issues, ...state.releases].some((record) => record.code === code));
  assert.equal(getReinspectable(state, 'issue-history'), 0);
});

test('独立状态不共享资料/历史，业务日期按上海自然日', () => {
  const first = createInspectionState(); const second = createInspectionState(); first.records[0].good = 999; task(first).documents[0].version = 'changed';
  assert.equal(second.records[0].good, 47); assert.equal(task(second).documents[0].version, 'V1.0');
  assert.equal(inspectionToday('2026-09-11T15:59:59.000Z'), '2026-09-11'); assert.equal(inspectionToday('2026-09-11T16:00:00.000Z'), '2026-09-12'); assert.throws(() => inspectionToday('invalid'), /操作时间/);
});

test('QC、QA与查看岗职责分离，QA只能终检授权，结案任务不可写', () => {
  const state = freeze(createInspectionState());
  for (const kind of ['accept','inspect','reinspect','transfer']) { assert.equal(canOperateInspection(state,'qc-a','task-final',kind), true); assert.equal(canOperateInspection(state,'qa-a','task-final',kind), false); }
  assert.equal(canOperateInspection(state,'qc-a','task-final','release'), false); assert.equal(canOperateInspection(state,'qa-a','task-final','release'), true); assert.equal(canOperateInspection(state,'qa-a','task-process'), false);
  for (const actorId of ['viewer-a', 'missing']) { assert.equal(canOperateInspection(state,actorId,'task-final'), false); assert.ok(errors(state, reinspect({actorId})).actorId); }
  for (const action of [accept(), inspect(), reinspect(), transfer(), release()]) assert.throws(() => act(state,{...action,taskId:'task-closed'}), /结案/);
});

test('接受报检要求人工复核和已发布SIP，接受本身不计初检', () => {
  const original = freeze(createInspectionState()); assert.ok(errors(original,accept({reviewed:false})).reviewed);
  assert.ok(errors(original,accept({taskId:'task-doc-pending'})).documents);
  const next = act(original,accept()); assert.equal(task(next,'task-pending').acceptedBy,'qc-a'); assert.equal(task(next,'task-pending').acceptedAt,now);
  assert.deepEqual(next.records,original.records); assert.equal(progress(next,'task-pending').initial,0); assert.throws(() => act(next,accept()), /已接受/);
});

test('分批初检消费未初检池，初检结果快照SIP、证据、照片和结论', () => {
  const original = freeze(accepted()); const input = inspect({photos:[photo()],evidence:'  功能读数正常，1件外观不合格  '});
  const next = act(original,input); const record = next.records.at(-1);
  assert.equal(record.quantity,10); assert.equal(record.good,9); assert.equal(record.bad,1); assert.equal(record.conclusion,'unqualified');
  assert.equal(record.sipCode,'SIP-IN100-INSPECT'); assert.equal(record.sipVersion,'V1.0'); assert.equal(record.evidence,'功能读数正常，1件外观不合格');
  assert.equal(progress(next,'task-pending').uninspected,10); assert.deepEqual(next.tasks,original.tasks);
  input.photos[0].name='changed'; assert.equal(record.photos[0].name,'检验.png');
  assert.equal(act(next,inspect({good:10,bad:0})).records.at(-1).conclusion,'qualified');
});

test('未接受、SIP未发布、未复核或缺检验依据均不能初检/复验', () => {
  const state = createInspectionState(); assert.match(errors(state,inspect())._form,/先接受/);
  const next = accepted();
  for (const input of [inspect({reviewed:false}),inspect({evidence:''}),inspect({evidence:'x'.repeat(2001)})]) assert.ok(Object.keys(errors(next,input)).length);
  task(next,'task-pending').documents[0].status='pending'; assert.ok(errors(next,inspect()).documents);
  task(state).documents[0].status='pending'; assert.ok(errors(state,reinspect()).documents);
});

test('检验数量只接受安全整数，合格不良之和一致，不超初检任务数量', () => {
  const state = accepted();
  for (const quantity of [0,-1,0.5,NaN,Infinity,'10',null]) assert.ok(errors(state,inspect({quantity})).quantity);
  for (const field of ['good','bad']) for(const value of [-1,0.1,NaN,Infinity,'1']) assert.ok(errors(state,inspect({[field]:value}))[field]);
  assert.ok(errors(state,inspect({good:8})).quantity); assert.ok(errors(state,inspect({quantity:21,good:20,bad:1})).quantity);
  const next=act(state,inspect({quantity:20,good:20,bad:0})); assert.equal(progress(next,'task-pending').uninspected,0); assert.throws(()=>act(next,inspect()),/剩 0/);
});

test('检验日期为真实日期且不早于任务不晚于今天，复验还不能早于处置完成', () => {
  const state=accepted(); for(const date of ['2026-02-30','2026-9-11','','2026-09-10','2026-09-12']) assert.ok(errors(state,inspect({date})).date);
  state.issues[0].disposedAt='2026-09-11T16:00:00.000Z'; assert.match(errors(state,reinspect()).date,/处置完成日期/);
  assert.deepEqual(errors(state,reinspect({date:'2026-09-12'}),'2026-09-12'),{});
});

test('不良整条转处理一次、不再累计检验数量，也不能跳过处置直接复验', () => {
  const original=freeze(createInspectionState()); const next=act(original,transfer()); const issue=next.issues.at(-1);
  assert.equal(issue.quantity,6); assert.equal(issue.readyQuantity,0); assert.equal(issue.dispositionCode,undefined); assert.equal(getTransferable(next,'record-process'),0);
  assert.deepEqual(progress(next,'task-process'),progress(original,'task-process')); assert.deepEqual(next.records,original.records);
  assert.throws(()=>act(next,transfer()),/已转处理/); assert.ok(errors(next,reinspect({taskId:'task-process',issueId:issue.id})).issueId);
  assert.ok(errors(original,transfer({taskId:'task-release',recordId:'record-release'})).recordId);
});

test('转不良限定同任务来源及人工复核，其他现象需要补说明', () => {
  const state=createInspectionState(); assert.ok(errors(state,transfer({recordId:'record-initial'})).recordId); assert.ok(errors(state,transfer({reviewed:false})).reviewed);
  assert.ok(errors(state,transfer({phenomenon:'unknown'})).phenomenon); assert.ok(errors(state,transfer({phenomenon:'其他',description:''})).description);
  assert.deepEqual(errors(state,transfer({description:''})),{}); assert.ok(errors(state,transfer({description:'x'.repeat(2001)})).description);
});

test('复验仅消费有凭据的已处置数量，不直接消费全部初检不良', () => {
  const original=freeze(createInspectionState()); const next=act(original,reinspect()); const record=next.records.at(-1);
  assert.equal(record.kind,'reinspection'); assert.equal(record.issueId,'issue-ready'); assert.equal(record.originalId,'record-initial');
  assert.equal(getReinspectable(next,'issue-ready'),0); assert.equal(progress(next).qualified,49); assert.equal(progress(next).unresolved,1); assert.equal(progress(next).firstPassRate,94); assert.equal(progress(next).releasable,0);
  assert.deepEqual(next.records[0],original.records[0]); assert.equal(next.issues[0].quantity,3); assert.equal(next.issues[0].readyQuantity,2);
  assert.throws(()=>act(next,reinspect({quantity:1,good:1,bad:0})),/剩 0/); assert.ok(errors(original,reinspect({quantity:3,good:3,bad:0})).quantity);
});

test('无处置凭据、无合法处置日期、超原不良数量或缺初检根来源均不能复验', () => {
  for(const patch of [{dispositionCode:''},{disposedAt:undefined},{disposedAt:'invalid'},{readyQuantity:0},{readyQuantity:4},{readyQuantity:0.5},{recordId:'missing'}]) {
    const state=createInspectionState(); Object.assign(state.issues[0],patch); assert.ok(errors(state,reinspect()).issueId);
  }
  const state=createInspectionState(); assert.ok(errors(state,reinspect({issueId:'issue-history'})).issueId);
});

test('复验失败转入下一轮不良，根初检不变，多轮合格不双计未解决量', () => {
  const original=createInspectionState(); let state=act(original,reinspect({good:1,bad:1})); const failed=state.records.at(-1);
  assert.equal(progress(state).qualified,48); assert.equal(progress(state).unresolved,2);
  state=act(state,transfer({taskId:'task-final',recordId:failed.id})); const issue=state.issues.at(-1);
  assert.equal(issue.quantity,1); assert.equal(getReinspectable(state,issue.id),0); assert.equal(progress(state).unresolved,2);
  // Simulate a later P08 disposition source; P03 itself provides no disposition write action.
  const ready=structuredClone(state); Object.assign(ready.issues.at(-1),{readyQuantity:1,dispositionCode:'DISP-SECOND',disposedAt:'2026-09-11T04:00:00.000Z'});
  state=act(ready,reinspect({issueId:issue.id,quantity:1,good:1,bad:0}));
  assert.equal(state.records.at(-1).originalId,'record-initial'); assert.equal(state.records.at(-1).issueId,issue.id);
  assert.equal(progress(state).qualified,49); assert.equal(progress(state).unresolved,1); assert.equal(progress(state).firstGood,47); assert.equal(progress(state).firstBad,3); assert.equal(progress(state).firstPassRate,94);
  assert.equal(progress(state).retested,3); assert.equal(progress(state).retestBad,1);
});

test('本次复验保存当前SIP快照，不覆盖首次或以前复验所用版本', () => {
  const state=createInspectionState(); task(state).documents[0].version='V1.1'; const next=act(state,reinspect());
  assert.equal(next.records[0].sipVersion,'V1.0'); assert.equal(next.records.at(-1).sipVersion,'V1.1');
  task(next).documents[0].version='V1.2'; assert.equal(next.records.at(-1).sipVersion,'V1.1');
});

test('QA放行要求终检、全部初检完成及无未解决不良，QC无授权权限', () => {
  const state=createInspectionState(); assert.ok(errors(state,release({actorId:'qc-a'})).actorId);
  assert.ok(errors(state,release({taskId:'task-process'}))._form); assert.match(errors(state,release({taskId:'task-final'}))._form,/未解决不良/);
  const partial=structuredClone(state); partial.records.find(item=>item.id==='record-release').quantity=5; partial.records.find(item=>item.id==='record-release').good=5;
  assert.match(errors(partial,release())._form,/全部初检完成/);
  assert.ok(errors(state,release({reviewed:false})).reviewed); assert.ok(errors(state,release({basis:''})).basis);
});

test('分次QA放行限累计合格剩余，保留独立授权凭据且不生成出货或改变检验', () => {
  const original=freeze(createInspectionState()); let next=act(original,release()); assert.equal(progress(next,'task-release').released,4); assert.equal(progress(next,'task-release').releasable,6);
  next=act(next,release({quantity:6})); assert.equal(progress(next,'task-release').released,10); assert.equal(progress(next,'task-release').releasable,0);
  assert.deepEqual(next.records,original.records); assert.deepEqual(next.tasks,original.tasks); assert.deepEqual(next.issues,original.issues);
  assert.equal(next.releases.at(-1).actorId,'qa-a'); assert.equal(next.releases.at(-1).basis,'QA-APPROVAL-0911 授权放行记录');
  assert.throws(()=>act(next,release({quantity:1})),/最多还可放行 0/); assert.equal('shipments' in next,false);
});

test('照片可选且PNG/JPEG深度复制，重复或超限以及伪造MIME/大小拒绝', () => {
  const state=accepted(); assert.deepEqual(errors(state,inspect({photos:[]})),{});
  for(const photos of [null,[photo(),photo()],Array(4).fill(photo()),[photo({type:'image/gif'})],[photo({size:0})],[photo({size:10*1024*1024+1})],[photo({size:2})],[photo({dataUrl:'data:image/jpeg;base64,AA=='})],[photo({dataUrl:'data:image/png;base64,@@'})]]) assert.ok(errors(state,inspect({photos})).photos);
  const photos=[photo()]; const next=act(state,inspect({photos})); photos[0].name='changed'; assert.equal(next.records.at(-1).photos[0].name,'检验.png');
});

test('陈旧状态、未知来源、坏时间或校验失败均原子拒绝，历史不能被后续对象修改', () => {
  const state=freeze(createInspectionState()); const before=JSON.stringify(state);
  for(const version of [0,2,1.1,NaN,'1']) assert.throws(()=>act(state,reinspect(),version),/数据已变化/);
  assert.throws(()=>act(state,reinspect(),1,'invalid'),/操作时间无效/); assert.ok(errors(state,{...reinspect(),taskId:'missing'}).taskId); assert.ok(errors(state,null)._form);
  assert.ok(errors(state,{...reinspect(),kind:'dispose'})._form); assert.ok(errors(state,reinspect(),'invalid')._form);
  const next=act(state,reinspect()); assert.throws(()=>act(next,reinspect(),1),/数据已变化/); assert.equal(JSON.stringify(state),before);
});

test('CSV覆盖初检、处置、复验根来源、QA、历史和照片元数据，限定当前任务', () => {
  const state=act(createInspectionState(),reinspect({photos:[photo()]})); const csv=buildInspectionCsv(freeze(state),'task-final'); const rows=parseCsv(csv);
  assert.equal(csv.charCodeAt(0),0xFEFF); assert.ok(rows.every(row=>row.length===4));
  for(const section of ['检验任务','检验进度','SIP 摘要','检验记录','不良与处置','操作记录']) assert.ok(rows.some(row=>row[0]===section),section);
  for(const value of ['QC-0911-001','NCR-0911-001','DISP-0911-001','record-initial','issue-ready','检验.png']) assert.ok(rows.some(row=>row[3]===value),value);
  assert.equal(csv.includes('data:image/png;base64'),false); assert.ok(csv.includes('不包含图片文件')); assert.equal(csv.includes('QC-0911-003'),false);
  const history=buildInspectionCsv(state,'task-closed'); assert.ok(history.includes('QA-REL-0907-02')); assert.ok(history.includes('RETEST-0907-02'));
});

test('CSV保留中文与多行读数，防止公式及前导空白绕过；导出不改变来源', () => {
  const state=createInspectionState(); state.records[0].evidence='中文,"读数"\n第二行';
  assert.ok(parseCsv(buildInspectionCsv(state,'task-final')).some(row=>row[3]==='中文,"读数"\n第二行'));
  for(const value of ['=1+1','+SUM(A1)','-1+1','@SUM(A1)','  =1+1','\t=1+1','\u0000@SUM(A1)','\uFEFF=1+1','\ttext']) { state.records[0].evidence=value; const row=parseCsv(buildInspectionCsv(state,'task-final')).find(row=>row[0]==='检验记录'&&row[1]==='QC-0911-001'&&row[2]==='检验记录或读数说明'); assert.equal(row[3],`'${value}`); }
  const before=JSON.stringify(state); buildInspectionCsv(state,'task-final'); assert.equal(JSON.stringify(state),before); assert.throws(()=>buildInspectionCsv(state,'missing'),/任务已不存在/);
});
