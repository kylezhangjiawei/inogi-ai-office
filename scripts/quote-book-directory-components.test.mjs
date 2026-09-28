import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const model = {}; new Function("exports", compile("../src/app/procurement/quoteBookDirectoryModel.ts"))(model);
const source = compile("../src/app/procurement/components/QuoteBookSupplierView.tsx");
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree,...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const primitives = new Proxy({}, {get:(_,key)=>key});
const material = (id,supplier='s1',patch={}) => ({id,name:`物料 ${id}`,spec:'M20',unit:'件',category:'阀类',tpInventoryCode:`T-${id}`,quotes:[{id:`q-${id}`,materialId:id,supplierId:supplier,supplierName:supplier,supplier:{id:supplier,name:`厂家 ${supplier}`,enabled:true,source:'local'},tiers:[{minQty:10,unitPrice:3}],leadTimeDays:5,currency:'CNY'}],...patch});
async function fixture({rows=[material('m1')],suppliers=[],relations=[],tasks=[],canWrite=true,permissions=true,fail=false}={}){
 const slots=[];let cursor=0,dirty=true,effects=[],tree; const compared=[],edited=[];
 const props={rows,today:'2026-09-21',canWrite,onCompare:r=>compared.push(r),onEdit:(...args)=>edited.push(args),onCreate(){},onImport(){},onQualifications(){}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
 useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
 useEffect(fn,deps){const i=cursor++;const before=slots[i];if(!same(before?.deps,deps)){const next={deps};slots[i]=next;effects.push(()=>{before?.cleanup?.();next.cleanup=fn();});}}
 };
 const user={id:'u1',permissions:['page:proc-quote-book']};const jsx=(type,props,key)=>typeof type==='function'&&type.name==='Pager'?type(props):({type,props,key});
 const deps={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'../../auth':{useAuth:()=>({user})},'../../lib/i18n':{useI18n:()=>({t:(s,p={})=>s.replace(/\{(\w+)\}/g,(m,k)=>p[k]??m)})},'../../lib/procurementApi':{listSupplierDirectory:async()=>{if(fail)throw new Error('目录不可用');return{suppliers};},listProcTasks:async()=>tasks},'../../lib/supplierQualificationsApi':{listSupplyQualifications:async()=>({relations})},'../quoteBookDirectoryModel':model,'../supplierQualificationsModel':{SUPPLY_QUALIFICATION_LABELS:{pending:'待审核'}},'./common':{useProcCan:()=>()=>permissions,PROC_STATUS_META:{in_transit:{label:'在途'},priced:{label:'已定价'}},ImageLightbox:'ImageLightbox'},'./TaskDetailDrawer':{TaskDetailDrawer:'TaskDetailDrawer'},'./QuoteBookSupplierView.css':{},sonner:{toast:{success(){},error(){}}}};
 const exports={};new Function('exports','require',source)(exports,name=>{if(name in deps)return deps[name];assert.ok(name==='lucide-react'||name.startsWith('../../components/'),name);return primitives;});
 const api={props,compared,edited,render(){for(let n=0;n<30;n++){cursor=0;dirty=false;tree=exports.QuoteBookSupplierView(props);const queue=effects;effects=[];queue.forEach(fn=>fn());if(!dirty)return tree;}assert.fail('render loop');},all(){return nodes(api.render());},text(){return text(api.render());},button(label){return api.all().find(n=>['Button','button'].includes(n.type)&&(n.props['aria-label']===label||text(n).trim()===label));},click(label){const b=api.button(label);assert.ok(b,label);assert.ok(!b.props.disabled);b.props.onClick();api.render();},input(label,value){const n=api.all().find(n=>n.type==='Input'&&n.props['aria-label']===label);assert.ok(n,label);n.props.onChange({target:{value}});api.render();},choices(){return api.all().filter(n=>n.type==='Button'&&n.props['aria-pressed']!==undefined);},table(label){return api.all().find(n=>n.type==='table'&&n.props['aria-label']===label);},materialRows(){return nodes(api.table('供应商物料清单')).filter(n=>n.type==='tr'&&n.props['aria-selected']!==undefined);},refresh(rows){props.rows=rows;api.render();},async settle(){await new Promise(r=>setImmediate(r));api.render();}};
 api.render();await api.settle();return api;
}
test('供应商列表含无报价ERP档案；已有报价关联档案只展示一次',async()=>{
 const page=await fixture({suppliers:[{id:'s1',name:'厂家 s1',source:'local',enabled:true},{id:'erp',name:'ERP 新厂',source:'tplus',enabled:true,tpCode:'100'}]});
 assert.equal(page.choices().length,2);assert.match(page.text(),/ERP 新厂/);assert.doesNotMatch(page.text(),/受控物料目录/);
 page.choices().find(n=>text(n).includes('ERP 新厂')).props.onClick();assert.match(page.text(),/暂无匹配物料/);assert.ok(page.button('编辑信息'));
});
test('供应商和物料分页、编码筛选及刷新缩页',async()=>{
 const rows=Array.from({length:24},(_,i)=>material(`m${String(i).padStart(2,'0')}`));const page=await fixture({rows});
 assert.equal(page.materialRows().length,10);page.click('物料清单下一页');assert.equal(page.materialRows().length,10);page.click('物料清单下一页');assert.equal(page.materialRows().length,4);
 page.input('搜索当前供应商的物料','T-m01');assert.equal(page.materialRows().length,1);page.input('搜索当前供应商的物料','');page.refresh(rows.slice(0,2));assert.equal(page.materialRows().length,2);
 const directory=await fixture({rows:Array.from({length:15},(_,i)=>material(`m${i}`,`s${String(i).padStart(2,'0')}`))});assert.equal(directory.choices().length,12);directory.click('供应商列表下一页');assert.equal(directory.choices().length,3);
});
test('切换供应商清空旧物料筛选，不混用同名物料ID',async()=>{
 const page=await fixture({rows:[material('one','a'),material('two','b')]});page.input('搜索当前供应商的物料','不存在');assert.equal(page.materialRows().length,0);page.choices()[1].props.onClick();assert.equal(page.materialRows().length,1);assert.match(text(page.materialRows()[0]),/two/);
 page.click('查看');assert.equal(page.compared[0].id,'two');page.click('编辑');assert.equal(page.edited[0][1].id,'q-two');
});
test('只读用户没有维护入口；报价有效不等于供货合格',async()=>{
 const page=await fixture({canWrite:false,permissions:false,relations:[{id:'r',materialId:'m1',supplierId:'s1',supplierName:'厂家 s1',effectiveStatus:'pending'}]});
 assert.equal(page.button('编辑'),undefined);assert.equal(page.button('新增供应商'),undefined);assert.equal(page.button('录入报价'),undefined);assert.match(page.text(),/暂无有效的合格供应商记录/);assert.match(page.text(),/待审核/);
});
test('合格供应商展示真实适用范围和主供角色',async()=>{
 const page=await fixture({suppliers:[{id:'s1',name:'厂家 s1',enabled:true,source:'local',materialRoles:{m1:'primary'}}],relations:[{id:'r',materialId:'m1',supplierId:'s1',supplierName:'厂家 s1',effectiveStatus:'approved',products:[{id:'p',name:'Q7'}],effectiveFrom:'2026-09-01',effectiveUntil:null}]});assert.match(page.text(),/主供/);assert.match(page.text(),/Q7/);assert.ok(page.button('查看供货资格'));
});
test('关联单据按物料ID匹配、同订单行去重、查看使用只读原详情',async()=>{
 const task={id:'t1',code:'PR1',materialId:'m1',materialName:'物料 m1',quantity:2,unit:'件',businessLine:'rd',status:'in_transit',purchaseOrders:[{id:'o',tpOrderNo:'PO1',tpLineNo:'1',supplierName:'厂家 s1',orderedQty:2,receivedQty:0}]};
 const page=await fixture({tasks:[task,{...task,id:'t2',code:'PR2'},{...task,id:'unrelated',code:'不能出现',materialId:'other'}]});
 const related=page.table('关联需求与订单列表');const content=text(related);assert.equal((content.match(/PO1/g)||[]).length,1);assert.doesNotMatch(content,/不能出现/);
 nodes(related).find(n=>n.type==='Button').props.onClick();const drawer=page.all().find(n=>n.type==='TaskDetailDrawer');assert.equal(drawer.props.readOnly,true);assert.equal(drawer.props.task.id,'t1');
});
test('加载失败保留错误和重试，不伪造供应商资料',async()=>{
 const page=await fixture({fail:true});assert.match(page.text(),/目录不可用/);assert.ok(page.button('重试'));assert.match(page.text(),/档案待关联/);assert.match(page.text(),/未填写/);
});
