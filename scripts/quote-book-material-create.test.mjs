import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const file=readFileSync(new URL('../src/app/procurement/components/modals.tsx',import.meta.url),'utf8');
const component=file.slice(file.indexOf('export function MaterialFormModal'),file.indexOf('// ── 畅捷通 T+ 集成'));
const compiled=ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children),...nodes(x.props?.footer),...nodes(x.props?.feedback)]:[];
const text=x=>Array.isArray(x)?x.map(text).join(''):x&&typeof x==='object'?text(x.props?.children):x==null||typeof x==='boolean'?'':String(x);
function fixture({permission=true,failPublish=false,retryMode,material}={}) {
 const slots=[];let cursor=0,tree;const creates=[],publishes=[],completed=[],errors=[];let closed=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];};
 const useRef=initial=>{const i=cursor++;return slots[i]??={current:initial};};
 const bindings={useState,useRef,useMemo:fn=>fn(),useEffect(){},useI18n:()=>({t:s=>s}),useProcCan:()=>()=>permission,useProcurementData:()=>({materials:[]}),useProductLines:()=>[],cn:(...s)=>s.join(' '),
 upsertProcMaterial:async(data,id)=>{creates.push(data);return{id:id||'new1',...data};},publishTplusMaterial:async(id,input)=>{publishes.push({id,input});if(failPublish){failPublish=false;throw Object.assign(Error('ERP连接失败'),{erpPublishRetry:retryMode});}return{tpInventoryCode:input.code};},refreshProcurement:async()=>{},toast:{success(){},error:s=>errors.push(s)}};
 for(const name of ['Shell','Button','Input','NativeSelect','Select','SelectTrigger','SelectValue','SelectContent','SelectItem','ComboInput','RadioGroup','RadioGroupItem','Checkbox','Loader2','Trash2','ImagePlus'])bindings[name]=name;
 const jsx=(type,props)=>({type,props});const exports={};
 new Function('exports','require',...Object.keys(bindings),compiled)(exports,()=>({jsx,jsxs:jsx,Fragment:'Fragment'}),...Object.values(bindings));
 const api={creates,publishes,completed,errors,render(){cursor=0;tree=exports.MaterialFormModal({material,allowErp:true,onCreated:m=>completed.push(m),onClose:()=>closed++});return tree;},all(){return nodes(api.render());},input(label,value){const wrapper=api.all().find(n=>n.type==='label'&&text(n).replace('*','')===label);assert.ok(wrapper,label);const input=nodes(wrapper).find(n=>n.type==='Input'||n.type==='ComboInput');assert.ok(input,label);input.props.onChange(input.type==='ComboInput'?value:{target:{value}});api.render();},destination(value){const radio=api.all().find(n=>n.type==='RadioGroupItem'&&n.props.value===value);const group=api.all().find(n=>n.type==='RadioGroup');assert.ok(!group.props.disabled&&!radio.props.disabled);group.props.onValueChange(value);api.render();},async save(){const b=api.all().find(n=>n.type==='Button'&&/^(保存|重试录入ERP)/.test(text(n)));b.props.onClick();await new Promise(r=>setImmediate(r));api.render();},get closed(){return closed;}};api.render();return api;
}
test('新增物料默认仅本系统，保存后回传物料且不调用ERP',async()=>{
 const f=fixture();f.input('物料名称','新物料');await f.save();assert.equal(f.creates.length,1);assert.equal(f.publishes.length,0);assert.equal(f.completed[0].id,'new1');assert.equal(f.closed,1);assert.equal(f.creates[0].tpInventoryCode,undefined);
});
test('ERP缺必填字段不创建本地；失败重试沿用同一本地物料及编码',async()=>{
 const f=fixture({failPublish:true});f.destination('erp');f.input('物料名称','新物料');await f.save();assert.equal(f.creates.length,0);
 f.input('单位','件');f.input('分类','五金');f.input('ERP存货编码','M9');f.input('ERP分类编码','C1');f.input('ERP单位编码','U1');
 await f.save();assert.equal(f.creates.length,1);assert.equal(f.closed,0);assert.match(f.errors.at(-1),/本系统物料已保存/);
 await f.save();assert.equal(f.creates.length,1);assert.equal(f.publishes.length,2);assert.equal(f.publishes[1].id,'new1');assert.equal(f.completed[0].tpInventoryCode,'M9');assert.equal(f.closed,1);
});
test('没有ERP同步权限仍可本地新增，但不能选择ERP',()=>{
 const f=fixture({permission:false});assert.equal(f.all().find(n=>n.type==='RadioGroupItem'&&n.props.value==='erp').props.disabled,true);
});

test('明确失败可更正ERP编码并复用本地物料，结果不明时锁住全部ERP设置',async()=>{
 for(const retryMode of ['editable','same-input']){
  const f=fixture({failPublish:true,retryMode});f.destination('erp');
  for(const [label,value] of [['物料名称','新物料'],['单位','件'],['分类','五金'],['ERP存货编码','M9'],['ERP分类编码','C1'],['ERP单位编码','U1']])f.input(label,value);
  await f.save();
  const fields=f.all().find(n=>n.type==='fieldset'&&nodes(n).some(child=>child.props?.['aria-label']==='ERP存货编码'));
  assert.equal(fields.props.disabled,retryMode==='same-input');
  assert.equal(f.all().find(n=>n.type==='Select'&&n.props.value==='01').props.disabled,retryMode==='same-input');
  if(retryMode==='editable'){f.input('ERP存货编码','M10');await f.save();assert.equal(f.creates.length,1);assert.equal(f.publishes[1].input.code,'M10');}
 }
});

test('已有本地物料可继续录入ERP，并保持原物料ID',async()=>{
 const f=fixture({material:{id:'existing',name:'物料',unit:'件',category:'五金'}});f.destination('erp');
 f.input('ERP存货编码','M9');f.input('ERP分类编码','C1');f.input('ERP单位编码','U1');await f.save();
 assert.equal(f.publishes[0].id,'existing');assert.equal(f.closed,1);
});
