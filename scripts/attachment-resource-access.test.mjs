import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
function moduleAt(path, dependencies, globals={}) {
 const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={}; new Function('exports','require',...Object.keys(globals),code)(exports,name=>{assert.ok(name in dependencies,name);return dependencies[name];},...Object.values(globals));return exports;
}
function sharedFixture() {
 let user='A', now=1000, logout; const reports=[], clicks=[], warnings=[];
 const link={click(){clicks.push(this.href)},remove(){}};
 const auth={getStoredUser:()=>user?{id:user}:null,addAuthClearedListener(fn){logout=fn},authFetch:async(url,init)=>{reports.push({url,init});return new Response(null,{status:204})}};
 const context={window:{dispatchEvent(){},setTimeout(fn){fn()}},CustomEvent:class{},Date:{now:()=>now},console:{warn:(...args)=>warnings.push(args)},document:{body:{appendChild(){}},createElement(){return {...link}}},URL:{createObjectURL:()=> 'blob:download',revokeObjectURL(){}},fetch:async()=>new Response('original',{headers:{'Content-Type':'image/png'}})};
 const api=moduleAt('src/app/lib/resourceAccess.ts',{'./authSession':auth},context);
 return {api,context,auth,reports,clicks,warnings,setUser(value){user=value},logout(){user=null;logout()},tick(){now+=60001}};
}
function adapters(fixture, overrides={}) {
 const data={attachmentList:[{id:'1',fileName:'中文 100%.png',fileUrl:'new-original',thumbUrl:'new-thumb'}]};
 return moduleAt('src/app/lib/attachmentAccess.ts',{'./resourceAccess':fixture.api,'./procurementApi':{getProcTask:async()=>data},'./rdApi':{},...overrides});
}
test('采购按原任务ID重读且只返回匹配附件，保留中文名称和原图/缩略图',async()=>{
 const f=sharedFixture();let calls=0;
 const a=adapters(f,{'./procurementApi':{getProcTask:async(id)=>{calls++;assert.equal(id,'task');return {attachmentList:[{id:'1',fileName:'中文 100%.png',fileUrl:'fresh-original',thumbUrl:'fresh-thumb'}]}}}});
 const item=a.procurementAttachmentPreview('task',{id:'1',fileName:'old',fileUrl:'expired'});
 const [one,two]=await Promise.all([item.refresh(),item.refresh()]);assert.equal(calls,1);assert.equal(one.url,'fresh-original');assert.equal(two.thumbUrl,'fresh-thumb');assert.equal(one.name,'中文 100%.png');
 await assert.rejects(a.procurementAttachmentPreview('task',{id:'deleted'}).refresh(),/无权查看/);
});
test('RD续签强制绕过缓存，按ID匹配，切工作区或被撤权后不交付旧URL',async()=>{
 const f=sharedFixture();let workspace='rd';let resolve;
 const a=adapters(f,{'./rdApi':{currentRdWorkspace:()=>workspace,fetchRdTaskAttachments:(id,options)=>{assert.equal(id,'task');assert.equal(options.force,true);return new Promise(done=>resolve=done)}}});
 const pending=a.refreshRdAttachment({id:'1',task_id:'task'});await new Promise(setImmediate);workspace='us-collab';resolve({attachments:[{id:'1',preview_url:'private-A'}]});await assert.rejects(pending,/工作区已变更/);
 await assert.rejects(a.refreshRdAttachment({id:'1'}),/重新打开任务/);
 const blocked=adapters(f,{'./procurementApi':{getProcTask:async()=>{throw Error('403')}}});
 await assert.rejects(blocked.procurementAttachmentPreview('task',{id:'1',fileUrl:'expired'}).refresh(),/403/);
});
test('前端故障上报按账号阶段限频且仅含阶段和状态码，退出登录停止上报',async()=>{
 const f=sharedFixture();f.api.reportResourceFailure('renew',403);f.api.reportResourceFailure('renew',503);f.api.reportResourceFailure('https://example.com/?auth_key=secret',403);f.api.reportResourceFailure('download',NaN);
 await new Promise(setImmediate);assert.equal(f.reports.length,2);assert.deepEqual(JSON.parse(f.reports[0].init.body),{stage:'renew',status:403});assert.deepEqual(JSON.parse(f.reports[1].init.body),{stage:'download'});assert.ok(!JSON.stringify(f.reports).includes('secret'));assert.ok(!JSON.stringify(f.warnings).includes('secret'));
 f.tick();f.api.reportResourceFailure('renew',403);await new Promise(setImmediate);assert.equal(f.reports.length,3);f.logout();f.api.reportResourceFailure('load');assert.equal(f.reports.length,3);
});
test('附件下载先续签原图，403只重试一次，失去权限不退旧链接',async()=>{
 const f=sharedFixture();const reads=[];let calls=0;
 f.context.fetch=async url=>{reads.push(url);return calls++===0?new Response('expired',{status:403}):new Response('image',{headers:{'Content-Type':'image/png'}})};
 const api=moduleAt('src/app/lib/resourceAccess.ts',{'./authSession':f.auth},f.context);let renewed=0;
 await api.downloadResource('expired-thumb','中文.png',async()=>`original-${++renewed}`);assert.deepEqual(reads,['original-1','original-2']);assert.equal(f.clicks.length,1);
 await assert.rejects(api.downloadResource('expired','private.png',async()=>{throw Error('forbidden')}),/下载失败/);assert.equal(reads.length,2);
});
test('大文件交给浏览器下载管理器，不完整缓冲；下载期间切账号则不保存',async()=>{
 const f=sharedFixture();let buffered=false,cancelled=false;
 f.context.fetch=async()=>({ok:true,status:200,url:'fresh-large',headers:new Headers({'Content-Length':String(100*1024*1024)}),body:{cancel:async()=>{cancelled=true}},blob:async()=>{buffered=true;return new Blob()}});
 let api=moduleAt('src/app/lib/resourceAccess.ts',{'./authSession':f.auth},f.context);
 await api.downloadResource('old','large.mp4',async()=> 'new');assert.equal(buffered,false);assert.equal(cancelled,true);assert.deepEqual(f.clicks,['fresh-large']);
 f.context.fetch=async()=>({ok:true,status:200,headers:new Headers(),blob:async()=>{f.setUser('B');return new Blob(['private'])}});
 api=moduleAt('src/app/lib/resourceAccess.ts',{'./authSession':f.auth},f.context);
 await assert.rejects(api.downloadResource('private','private.png'),/下载失败/);assert.equal(f.clicks.length,1);
});
