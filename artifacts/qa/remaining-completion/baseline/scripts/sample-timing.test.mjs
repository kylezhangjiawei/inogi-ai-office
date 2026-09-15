import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

function load(path,deps={}) {
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={}; new Function('exports','require',output)(exports,id=>{assert.ok(id in deps,id);return deps[id];});return exports;
}
const facts=load('src/app/lib/procSampleFacts.ts');
const model=load('src/app/procurement/samples/sampleTimingModel.ts',{'../../lib/procSampleFacts':facts});
const t=(value,params={})=>value.replace(/\{(\w+)\}/g,(_,key)=>params[key]??key);
const {SampleTimingSummary}=load('src/app/procurement/samples/SampleTimingSummary.tsx',{'react/jsx-runtime':jsxRuntime,'../../lib/i18n':{useI18n:()=>({t}),i18nLocale:()=> 'zh-CN'},'./sampleTimingModel':model});
const detail=(overrides={})=>({task:{id:'sample-a',status:'testing',needSample:true,logs:[],expectedArrivalDate:'2026-09-13'},sampleTest:{roundId:'round-a',testerUserId:'rd-a',testerName:'研发甲',assignedAt:'2026-09-14T01:00:00Z',assignedByName:'采购甲',result:null,note:null,confirmedAt:null,confirmedByName:null},...overrides});
const render=(input,extra={})=>renderToStaticMarkup(React.createElement(SampleTimingSummary,{detail:input,...extra}));
const completed=()=>{const d=detail();return {...d,task:{...d.task,status:'priced'},sampleTest:{...d.sampleTest,result:'passed',note:'通过',confirmedAt:'2026-09-14T02:00:00Z',confirmedByName:'研发甲'}};};

test('分派和提交严格校验公历及带时区时间，不归一非法旧值',()=>{
  for(const value of ['2026-02-30T01:00:00Z','2026-09-14','2026-09-14T24:00:00Z','2026-09-14T01:00:00','0000-01-01T00:00:00Z','2026-09-14T01:00:60Z','garbage']) assert.equal(model.sampleOperationTime(value).state,'invalid',value);
  for(const value of ['0001-01-01T00:00:00Z','2024-02-29T23:59:59+08:00','2026-09-14T01:00:00.123Z']) assert.equal(model.sampleOperationTime(value).value,value);
  for(const value of [null,undefined,'']) assert.equal(model.sampleOperationTime(value).state,'missing');
});

test('有效本轮只展示操作时间，不把分派当实际到样或开测',()=>{
  const d=detail();const before=structuredClone(d);const result=model.sampleTiming(d);
  assert.equal(result.scope,'current'); assert.equal(result.expected.value,'2026-09-13');assert.equal(result.submitted.state,'missing');
  const html=render(d);assert.match(html,/当前有效测试记录/);assert.match(html,/实际到样<\/dt><dd[^>]*>未记录/);assert.match(html,/测试开始与结束尚无独立记录/);assert.doesNotMatch(html,/逾期|提前|用时/);assert.deepEqual(d,before);
});

test('本人通过结论保留提交时间，失败重送重询价、回退和取消只标保留记录',()=>{
  const done=completed();assert.equal(model.sampleTiming(done).scope,'current');
  for(const [status,result] of [['pending_sample','failed_resample'],['pending_inquiry','failed_requote'],['cancelled','passed']]) {
    const d={...done,task:{...done.task,status},sampleTest:{...done.sampleTest,result}};
    assert.equal(model.sampleTiming(d).scope,'retained');assert.match(render(d),/保留的测试记录/);
    assert.equal(model.sampleTiming(d).submitted.value,done.sampleTest.confirmedAt);
  }
  const reset={...done,task:{...done.task,logs:[{fromStatus:'priced',toStatus:'testing',createdAt:'2026-09-14T03:00:00Z'}]}};
  assert.equal(model.sampleTiming(reset).scope,'retained');
});

test('提交早于分派、缺身份、结论时间无效或只有提交时间时整条记录待核对',()=>{
  const d=completed();
  for(const patch of [{confirmedAt:'2026-09-13T01:00:00Z'},{testerUserId:''},{roundId:''},{assignedAt:'2026-02-30T00:00:00Z'},{confirmedAt:'invalid'},{result:null}]) {
    const data={...d,sampleTest:{...d.sampleTest,...patch}};
    assert.equal(model.sampleTiming(data).scope,'unverified');assert.match(render(data),/测试记录待核对/);assert.doesNotMatch(render(data),/Invalid Date/);
  }
});

test('无样品记录不借用采购或日志日期补到样，预计到货无效单独待核对',()=>{
  const d=detail({sampleTest:null,task:{id:'none',status:'pending_sample',expectedArrivalDate:'2026-02-30',logs:[{createdAt:'2026-09-14T01:00:00Z',text:'到样'}]}});
  assert.equal(model.sampleTiming(d).scope,'none');assert.equal(model.sampleTiming(d).expected.state,'invalid');assert.equal(model.sampleTiming(d).assigned.state,'missing');assert.match(render(d),/尚无测试分派/);
});

test('刷新或读取失败隐藏旧时间和人员，不把旧记录标为当前',()=>{
  for(const state of [{loading:true},{error:true}]) {
    const html=render(completed(),state);assert.doesNotMatch(html,/2026-09-13|研发甲|当前有效测试记录/);assert.match(html,/role="status"/);
  }
});


test('无测试结果却留有旧提交人或结论时不标有效，也不展示为提交人',()=>{
  for(const patch of [{confirmedByName:'旧提交人'},{note:'旧结论'}]) {
    const d=detail();d.sampleTest={...d.sampleTest,...patch};
    assert.equal(model.sampleTiming(d).scope,'unverified');assert.equal(model.sampleTiming(d).confirmedBy,null);
    assert.doesNotMatch(render(d),/旧提交人|当前有效测试记录/);
  }
});
