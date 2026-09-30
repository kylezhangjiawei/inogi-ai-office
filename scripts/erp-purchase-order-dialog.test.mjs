import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/app/order-processing/components/ErpPurchaseOrderDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const text=x=>Array.isArray(x)?x.map(text).join(''):x&&typeof x==='object'?text(x.props?.children):x==null||typeof x==='boolean'?'':String(x);
const t=(s,p)=>s.replace('{n}',p?.n??'');
const line={id:'L1',ts:'01',inventoryCode:'M1',unitName:'件',quantity:10,unitPrice:20,taxRate:13,etaDate:'2026-10-01'};
const view={id:'E1',ts:'01',orderNo:'PO-1',orderDate:'2026-09-29',supplierCode:'S1',supplierName:'供应商',contractNo:'C1',memo:'',editable:true,warnings:[],lines:[line]};
function fixture(mode='update',overrides={}){
 const slots=[];let cursor=0,tree;const effects=[],writes=[],saved=[],reads=[];
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old[j])){slots[i]=deps;effects.push(fn);}}};
 const api={options:async()=>({suppliers:[],materials:[]}),pending:async()=>null,read:async()=>{reads.push(1);return structuredClone(view);},status:async()=>null,write:async input=>{writes.push(structuredClone(input));return{orderNo:'PO-1',deleted:input.action==='delete',warnings:[]};},...overrides};
 const jsx=(type,props)=>({type,props}),ui=new Proxy({},{get:(_,key)=>key});const exports={};
 new Function('require','exports',code)(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name.endsWith('/i18n')?{useI18n:()=>({t})}:name.endsWith('/erpPurchaseOrderApi')?{erpPurchaseOrderApi:api}:name==='sonner'?{toast:{success(){},warning(){}}}:ui,exports);
 const f={writes,saved,reads,render(){cursor=0;tree=exports.ErpPurchaseOrderDialog({mode,orderNo:mode==='create'?undefined:'PO-1',onClose(){},onSaved:r=>saved.push(r)});while(effects.length)effects.shift()();return tree;},all(){return nodes(f.render());},find(type,name){return f.all().find(n=>n.type===type&&(text(n)===name||n.props['aria-label']===name));},async settle(){await new Promise(r=>setImmediate(r));f.render();},async click(name){const b=f.find('Button',name);assert.ok(b,name);assert.ok(!b.props.disabled,name);b.props.onClick();await f.settle();}};f.render();return f;
}
test('修改仅开放支持字段，原始行身份随请求保留',async()=>{const f=fixture();await f.settle();assert.equal(f.find('Input','第 1 行单价').props.disabled,true);assert.equal(f.find('Input','第 1 行预计到货日期').props.disabled,true);const quantity=f.find('Input','第 1 行数量');assert.equal(quantity.props.disabled,false);quantity.props.onChange({target:{valueAsNumber:12}});await f.click('保存到ERP并核对');assert.equal(f.writes[0].lines[0].id,'L1');assert.equal(f.writes[0].lines[0].quantity,12);assert.equal(f.writes[0].expectedTs,'01');});
test('只读查询没有提交入口，全部明细禁用',async()=>{const f=fixture('read');await f.settle();assert.equal(f.find('Button','保存到ERP并核对'),undefined);assert.equal(f.find('Input','第 1 行数量').props.disabled,true);assert.equal(f.writes.length,0);});
test('删除必须输入完整单号',async()=>{const f=fixture('delete');await f.settle();assert.equal(f.find('Button','确认删除ERP订单').props.disabled,true);const input=f.all().find(n=>n.type==='Input');input.props.onChange({target:{value:'PO-1'}});await f.click('确认删除ERP订单');assert.equal(f.writes[0].action,'delete');assert.equal(f.saved[0].deleted,true);});
test('重新打开待核对删除不读取已删除单据，沿用持久请求',async()=>{const input={requestId:'original-id',action:'delete',orderNo:'PO-1',lines:[]};const f=fixture('delete',{pending:async()=>({state:'confirmed',input})});await f.settle();assert.equal(f.reads.length,0);f.all().find(n=>n.type==='Input').props.onChange({target:{value:'PO-1'}});await f.click('核对上次操作');assert.equal(f.writes[0].requestId,'original-id');});
