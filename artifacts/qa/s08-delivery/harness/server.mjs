import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const project=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,'');
const preview=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,'');
const require=createRequire(`${project}/apps/api/package.json`);
const ts=require('typescript');
require('ts-node').register({transpileOnly:true,project:`${project}/apps/api/tsconfig.json`});
const {PurchaseDeliveryService}=require(`${project}/apps/api/src/modules/procurement/purchase-delivery.service.ts`);
const {DELIVERY_WRITE_PERMISSION,persistMirrorDelivery}=require(`${project}/apps/api/src/modules/procurement/purchase-delivery-store.ts`);
// Reuse the tested in-memory transaction fixture only. Do not instantiate PrismaService or connect a DB.
const source=readFileSync(`${project}/apps/api/test/purchase-delivery.spec.ts`,'utf8');
const ast=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['stamp','line','match','fixture']);
const chunks=ast.statements.filter(node=>ts.isFunctionDeclaration(node)?names.has(node.name?.text):ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>names.has(d.name.getText(ast)))).map(node=>node.getText(ast));
const code=ts.transpileModule(chunks.join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const {fixture,line}=new Function('PurchaseDeliveryService','assert','DELIVERY_WRITE_PERMISSION',`${code};return {fixture,line};`)(PurchaseDeliveryService,assert,DELIVERY_WRITE_PERMISSION);
const actors={
 'qa-manager':{id:'qa-manager',name:'隔离采购主管',permissions:['page:proc-my-workspace','page:purchase-orders','page:purchase-order-detail',DELIVERY_WRITE_PERMISSION,'page:proc-cockpit','proc-operations:assign']},
 'qa-reader':{id:'qa-reader',name:'隔离只读采购',permissions:['page:proc-my-workspace','page:purchase-orders','page:purchase-order-detail']},
 'qa-warehouse':{id:'qa-warehouse',name:'隔离仓管人员',permissions:['page:purchase-order-detail']},
 'qa-no-order':{id:'qa-no-order',name:'无订单权限账号',permissions:['page:proc-my-workspace']},
};
let f;const requests=[];const config={read:'success',save:'success'};const counts={read:0,submit:0,assignment:0};let active=0;
let assignments=new Map();
const candidates=[{id:'qa-warehouse',name:'隔离仓管人员',department:'仓库',kinds:['warehouse']},{id:'qa-quality',name:'隔离质量人员',department:'质量',kinds:['quality']}];
async function reset(){
 f=fixture(Array.from({length:27},(_,i)=>line(`qa-line-${String(i+1).padStart(2,'0')}`,{tpOrderNo:`QA-PO-${String(Math.floor(i/3)+1).padStart(3,'0')}`,tpLineNo:String(i%3+1),inventoryCode:i===1?'QA-001':`QA-${String(i+1).padStart(3,'0')}`,inventoryName:['隔离验证壳体','隔离验证线材','隔离验证安装套件'][i%3],unit:['件','米','套'][i%3],orderedQty:20+i,receivedQty:i%4===0?5:0,supplierName:i%2?'隔离供应商乙':'隔离供应商甲',etaDate:i===25?null:i===26?new Date('2026-10-06T00:00:00Z'):new Date(`2026-09-${String(i<22?18:24).padStart(2,'0')}T00:00:00Z`),orderDate:i===24?null:new Date(i===22?'2026-08-21T00:00:00Z':'2026-09-01T00:00:00Z')})));
 for(const row of f.lines().slice(0,2)){const data={...row};delete data.id;delete data.tpOrderNo;delete data.tpLineNo;await persistMirrorDelivery(f.db,row.tpOrderNo,row.tpLineNo,data);}
 const first=f.lines()[0];await f.service.record(first.id,{requestId:'qa_initial_record_0001',orderNo:first.tpOrderNo,promisedDate:'2026-09-16',communicatedOn:'2026-09-01',evidence:'隔离凭据 QA-MAIL-01',reason:'验证供应商最初承诺与 ERP 日期分别保留',declareOriginal:true,expectedVersion:0,expectedSourceUpdatedAt:first.updatedAt.toISOString()},actors['qa-manager']);
 assignments=new Map();requests.length=0;for(const key of Object.keys(counts))counts[key]=0;config.read='success';config.save='success';
}
await reset();
const readJson=async(req)=>{let body='';for await(const chunk of req){body+=chunk;if(body.length>128*1024)throw new Error('body too large');}return body?JSON.parse(body):{};};
const {createServer}=await import(require.resolve('vite'));
const plugin={name:'s08-tokenless-memory-only',enforce:'pre',configResolved(value){value.server.proxy=undefined;},resolveId(source,importer){if(!importer||(!source.startsWith('.')&&!source.startsWith('/')))return null;const candidate=resolve(dirname(importer.split('?')[0]),source).replace(/\.[jt]sx?$/,'');if(candidate===`${project}/src/app/auth`)return `${preview}/auth-preview.tsx`;if(candidate===`${project}/src/app/lib/authSession`)return `${preview}/auth-session-preview.ts`;return null;},configureServer(server){server.middlewares.use(async(req,res,next)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws://127.0.0.1:4186 ws://localhost:4186; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:;");
 const url=new URL(req.url||'/', 'http://127.0.0.1:4186'),path=url.pathname,method=req.method||'GET';
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
 if(path==='/__qa/s08-delivery'&&method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await server.transformIndexHtml(path,`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>S08 隔离验收</title></head><body><div id="root"></div><script type="module" src="/artifacts/qa/s08-delivery/harness/preview.tsx"></script></body></html>`));return;}
 if(path==='/__qa/state'&&method==='GET')return send({config,counts,active,requests,audits:f.audits,states:[...f.states().values()]});
 if(path==='/__qa/config'&&method==='POST'){const input=await readJson(req);for(const key of ['read','save'])if(['success','error','slow','conflict'].includes(input[key]))config[key]=input[key];return send({config});}
 if(path==='/__qa/reset'&&method==='POST'){if(active)return send({message:'模拟保存中'},409);await reset();return send({ok:true});}
 if(path==='/__qa/erp-change'&&method==='POST'){if(active)return send({message:'模拟保存中'},409);const row=f.lines()[0],data={...row,etaDate:new Date(row.etaDate?.toISOString().startsWith('2026-09-18')?'2026-09-22T00:00:00Z':'2026-09-18T00:00:00Z')};delete data.id;delete data.tpOrderNo;delete data.tpLineNo;await persistMirrorDelivery(f.db,row.tpOrderNo,row.tpLineNo,data);return send({ok:true});}
 if(path.startsWith('/__qa/'))return send({message:'隔离控制路径未注册'},404);
 if(!path.startsWith('/api/'))return next();
 requests.push({method,path,query:url.search,authorization:Boolean(req.headers.authorization),at:new Date().toISOString()});
 if(req.headers.authorization||req.headers['x-inogi-fixture']!=='S08-memory-only')return send({message:'仅允许无 token 的隔离请求'},403);
 const actor=actors[req.headers['x-qa-user']];if(!actor)return send({message:'未知隔离账号'},403);
 const query=Object.fromEntries(url.searchParams);
 if(method==='GET'&&path.startsWith('/api/procurement/delivery/')){counts.read++;if(config.read==='slow')await new Promise(r=>setTimeout(r,3000));if(config.read==='error')return send({message:'隔离模拟：交期源加载失败'},503);}
 if(method==='GET'&&path==='/api/procurement/delivery/schedule')return send(await f.service.schedule(query,actor));
 const detail=path.match(/^\/api\/procurement\/delivery\/lines\/([^/]+)$/);
 if(method==='GET'&&detail)return send(await f.service.get(decodeURIComponent(detail[1]),query,actor));
 const save=path.match(/^\/api\/procurement\/delivery\/lines\/([^/]+)\/commitments$/);
 if(method==='POST'&&save){counts.submit++;active++;try{const input=await readJson(req);if(config.save==='slow')await new Promise(r=>setTimeout(r,3000));if(config.save==='error')return send({message:'隔离模拟：保存失败，草稿保留'},503);if(config.save==='conflict'){config.save='success';f.lines().find(r=>r.id===decodeURIComponent(save[1])).updatedAt=new Date();}return send(await f.service.record(decodeURIComponent(save[1]),input,actor));}finally{active--;}}
 if(method==='GET'&&path==='/api/procurement/operational-tasks/candidates')return send(candidates);
 const makeTasks=()=>f.lines().slice(0,4).map((row,i)=>({id:query.kind==='quality'?`qa-receipt-${i}`:row.id,kind:query.kind||'warehouse',lineId:row.id,orderNo:row.tpOrderNo,lineNo:row.tpLineNo,materialName:row.inventoryName,supplierName:row.supplierName,unit:row.unit,quantity:query.kind==='quality'?5:row.orderedQty-row.receivedQty,dueDate:assignments.get(`${query.kind}:${i}`)?.dueDate??(i===0?'2026-08-25':row.etaDate?.toISOString().slice(0,10)??null),completed:false,state:query.kind==='quality'?'待检验':'待收货',quantityBasis:query.kind==='quality'?'本地模拟未检收货量':'本地模拟订单未收量',sourceVersion:'qa-source-1',assignment:assignments.get(`${query.kind}:${i}`)??null,deliveryNo:query.kind==='quality'?`QA-DELIVERY-${i}`:null}));
 if(method==='GET'&&path==='/api/procurement/operational-tasks'){
 if(!actor.permissions.includes('page:purchase-order-detail'))return send({message:'无订单详情权限'},403);const manager=actor.permissions.includes('page:proc-cockpit');let items=makeTasks();if(!manager||!['all','unassigned'].includes(query.owner))items=items.filter(t=>t.assignment?.userId=== (manager?query.owner:actor.id));if(query.owner==='unassigned')items=items.filter(t=>!t.assignment?.userId);if(query.before)items=items.filter(t=>t.dueDate&&t.dueDate<query.before);if(query.status==='completed')items=[];return send({items,people:candidates.map(c=>({id:c.id,name:c.name})),nextCursor:null,canViewAll:manager,canAssign:manager&&actor.permissions.includes('proc-operations:assign'),scope:'local-memory-fixture'});}
 const assign=path.match(/^\/api\/procurement\/operational-tasks\/(warehouse|quality)\/([^/]+)\/assignment$/);
 if(method==='POST'&&assign){counts.assignment++;if(!actor.permissions.includes('proc-operations:assign')||!actor.permissions.includes('page:proc-cockpit'))return send({message:'无分派权限'},403);const input=await readJson(req),kind=assign[1],id=decodeURIComponent(assign[2]);const i=kind==='quality'?Number(id.split('-').at(-1)):f.lines().findIndex(r=>r.id===id);if(i<0||i>3)return send({message:'未知任务'},404);const target=candidates.find(c=>c.id===input.userId&&c.kinds.includes(kind));if(input.userId&&!target)return send({message:'负责人岗位不匹配'},400);const old=assignments.get(`${kind}:${i}`);if((old?.version??0)!==input.expectedVersion)return send({message:'分派版本变化，请刷新'},409);const record={version:(old?.version??0)+1,userId:input.userId,name:target?.name??'',note:input.note,dueDate:input.dueDate,at:new Date().toISOString(),by:actor.name};const value={...record,history:[...(old?.history??[]),record]};assignments.set(`${kind}:${i}`,value);return send(value);}
 return send({message:`隔离验证未注册 ${method} ${path}；未访问实际业务。`},method==='GET'?404:405);
 }catch(error){send({message:error.message},error.getStatus?.()??500);}
 });}};
const server=await createServer({root:project,configFile:`${project}/vite.config.ts`,envDir:preview,envPrefix:'UI_PREVIEW_UNUSED_',plugins:[plugin],cacheDir:`${preview}/.vite-cache`,optimizeDeps:{entries:[`${preview}/preview.tsx`]},define:{'import.meta.env.VITE_API_BASE':JSON.stringify(''),'import.meta.env.VITE_RECRUITMENT_API_BASE':JSON.stringify('')},server:{host:'127.0.0.1',port:4186,strictPort:true,hmr:false,watch:{ignored:['**/*']},fs:{allow:[project,preview]}}});await server.listen();console.log('S08 isolated: http://127.0.0.1:4186/__qa/s08-delivery');
