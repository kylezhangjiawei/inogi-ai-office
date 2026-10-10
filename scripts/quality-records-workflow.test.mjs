import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const node=(type,props)=>({type,props:props||{}});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'&&tree.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'&&tree.props?text(tree.props.children):tree==null?'':String(tree);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(path,name,props,mocks={},query=''){
 let index=0,initialized=false,params=new URLSearchParams(query);
 const slots=[],effects=[],cleanup=[];
 const control=new Proxy({}, {get:(_,key)=>String(key)});
 const defaults={
  'react/jsx-runtime':{jsx:node,jsxs:node,Fragment:'Fragment'},
  react:{useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=index++;return slots[i]??={current:initial};},useEffect(callback){if(!initialized)effects.push(callback);}},
  'react-router':{useSearchParams:()=>[params,next=>params=typeof next==='function'?next(params):next]},
  '../../auth':{useAuth:()=>({user:{id:'worker',permissions:[]}})},
  '../../hooks/usePermission':{usePermission:()=>false},
  './QualityAnalysisDialog':{QualityAnalysisDialog:'QualityAnalysisDialog',qualitySourceNames:{procurement:'采购',production:'生产',warehouse:'仓库',after_sales:'售后'},qualityCauseNames:{unknown:'未知 / 待分析',process:'工艺',material:'物料'}}
 };
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8')+(name==='QualityAnalysisContent'?'\nexport { QualityAnalysisContent };':'');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};new Function('require','exports',code)(key=>mocks[key]||defaults[key]||control,exports);
 const render=()=>{index=0;const tree=exports[name](props);if(!initialized){initialized=true;effects.forEach(effect=>{const fn=effect();if(fn)cleanup.push(fn);});}return tree;};
 return {render,exports,params:()=>params,destroy:()=>cleanup.forEach(fn=>fn())};
}
const record={id:'q1',source:'production',batchNo:'B1',treeNodeName:'装配',issue:'划痕',unit:'件',inspectedQty:160,defectiveQty:6,status:'open',disposition:'pending',updatedAt:'2026-09-20T00:00:00Z',analysis:{version:1,state:'pending',category:'unknown',detail:'',evidence:'现场照片',responsibility:{kind:'unknown',name:''},phenomena:[{name:'划痕',count:6},{name:'偏位',count:2}],files:[],references:[{source:'warehouse',reference:'R1',note:'同一批'}],history:[]}};

test('主因筛选同时更新记录、件数及现象统计',()=>{
 const confirmed={...record,id:'q2',analysis:{...record.analysis,state:'confirmed',category:'process'}};
 const f=fixture('src/app/procurement/quality/QualityRecordsPanel.tsx','QualityRecordsPanel',{records:[record,confirmed],onSaved(){}});
 nodes(f.render()).find(row=>row.props['aria-label']==='质量主因').props.onChange({target:{value:'process'}});
 const result=text(f.render());
 assert.match(result,/原异常\s*1\s*条/); assert.doesNotMatch(result,/原异常\s*2\s*条/);
 assert.match(result,/不良\s*6\s*件/);
});
test('质量汇总原ID去重，6件8次分离、未知单列且供应商分组不用同名串数据',()=>{
 const f=fixture('src/app/procurement/quality/QualityRecordsPanel.tsx','QualityRecordsPanel',{records:[],onSaved(){}});
 const summary=f.exports.qualityRecordSummary([record,{...record},{...record,id:'q2',source:'procurement',materialId:'m1',materialName:'同名物料',supplierId:'s1',supplierName:'同名供应商'},{...record,id:'q3',source:'procurement',materialId:'m2',materialName:'同名物料',supplierId:'s1',supplierName:'同名供应商'}]);
 assert.equal(summary.records.length,3);assert.equal(summary.units[0].defective,18);assert.equal(summary.occurrences,24);assert.equal(summary.unknown,3);assert.equal(summary.suppliers.length,2);
});
test('质量深链仅打开传入授权记录，关闭仅删除quality并保留计划与月份',()=>{
 const f=fixture('src/app/procurement/quality/QualityRecordsPanel.tsx','QualityRecordsPanel',{records:[record],onSaved(){}},{},'plan=p&month=2026-09&view=quality&quality=q1');
 const dialog=nodes(f.render()).find(row=>row.type==='QualityAnalysisDialog');assert.equal(dialog.props.id,'q1');dialog.props.onClose();
 assert.equal(f.params().has('quality'),false);assert.equal(f.params().get('plan'),'p');assert.equal(f.params().get('view'),'quality');
 const other=fixture('src/app/procurement/quality/QualityRecordsPanel.tsx','QualityRecordsPanel',{records:[record],onSaved(){}},{},'quality=other');
 assert.equal(nodes(other.render()).some(row=>row.type==='QualityAnalysisDialog'),false);assert.match(text(other.render()),/不在当前授权范围/);
});
test('现场不良表单提交真实上传ID、原报工6件与8次现象，实领批号来自已签收',async()=>{
 const writes=[],uploads=[],saved=[];
 const task={id:'t',name:'装配',line:'一线',unit:'件',reports:[{id:'r',date:'2026-09-20',quantity:160,goodQty:154}],inspections:[],fieldIssues:[]};
 const f=fixture('src/app/production/execution/ProductionFieldIssueDialog.tsx','ProductionFieldIssueDialog',{task,plan:{id:'p',version:4,month:'2026-09',batches:[]},onClose(){},onSaved:()=>saved.push(true)},{
  '../../lib/productionExecutionApi':{getExecutionOptions:async()=>({users:[{id:'rd1',name:'研发甲',department:'研发部',canCollaborate:true},{id:'qa1',name:'质量甲',department:'质量部',canCollaborate:true}]}),commandExecutionPlan:async(id,input)=>writes.push({id,...input})},
 '../../lib/warehouseFlowApi':{getWarehouseFlows:async()=>({items:[{taskId:'t',lines:[{code:'M',name:'阀',unit:'件',signedQty:320,signedBatches:[{batchNo:'LOT-A',quantity:320}]}]}]})},
 '../../lib/resourceUpload':{uploadResourceFile:async(file,type,options)=>{uploads.push({file,type,options});return{fileId:'real-upload',fileName:file.name};}}
 });
 f.render();await flush();
 const label=(name)=>nodes(f.render()).find(row=>row.type==='label'&&text(row).startsWith(name));
 nodes(label('不良摘要')).find(row=>row.type==='Input').props.onChange({target:{value:'划痕及偏位'}});
 nodes(f.render()).find(row=>row.props['aria-label']==='现场现象 1').props.onChange({target:{value:'划痕'}});
 nodes(f.render()).find(row=>row.props['aria-label']==='现场现象 1 次数').props.onChange({target:{value:'6'}});
 nodes(f.render()).find(row=>row.type==='Button'&&text(row)==='添加其他现象').props.onClick();
 nodes(f.render()).find(row=>row.props['aria-label']==='现场现象 2').props.onChange({target:{value:'偏位'}});
 nodes(f.render()).find(row=>row.props['aria-label']==='现场现象 2 次数').props.onChange({target:{value:'2'}});
 nodes(label('现场说明')).find(row=>row.type==='Textarea').props.onChange({target:{value:'实物复核'}});
  nodes(label('初步原因')).find(row=>row.type==='NativeSelect').props.onChange({target:{value:'software'}});
  nodes(label('建议协同部门')).find(row=>row.type==='NativeSelect').props.onChange({target:{value:'研发部'}});
  assert.doesNotMatch(text(label('建议接收人')),/质量甲/);
  nodes(label('建议接收人')).find(row=>row.type==='NativeSelect').props.onChange({target:{value:'rd1'}});
 nodes(f.render()).find(row=>row.type==='Input'&&row.props.type==='file').props.onChange({target:{files:[new File([new Uint8Array([137,80,78,71])],'现场.png',{type:'image/png'})],value:'fake'}});await flush();
 nodes(f.render()).filter(row=>row.type==='NativeSelect').at(-1).props.onChange({target:{value:'LOT-A'}});
 nodes(f.render()).find(row=>row.type==='Button'&&text(row)==='提交不良').props.onClick();await flush();
 assert.equal(uploads[0].type,'assets');assert.equal(writes[0].data.defectiveQty,6);assert.equal(writes[0].data.phenomena.reduce((sum,row)=>sum+row.count,0),8);
 assert.deepEqual(writes[0].data.fileIds,['real-upload']);assert.equal(writes[0].data.reportId,'r');assert.deepEqual(writes[0].data.materialBatches,[{code:'M',batchNo:'LOT-A'}]);assert.equal(saved.length,1);
  assert.equal(writes[0].data.initialCause,'software');assert.deepEqual(writes[0].data.requestedCollaboration,{department:'研发部',ownerId:'rd1'});assert.equal(writes[0].action,'field-issue');assert.match(text(f.render()),/待负责人初判、分派/);
});
test('原因确认表单使用加载的原异常版本，责任确认独立，失败保留草稿并重试原请求ID',async()=>{
 const writes=[];let attempts=0;
 const f=fixture('src/app/procurement/quality/QualityAnalysisDialog.tsx','QualityAnalysisContent',{id:'q1',onClose(){},onSaved(){}},{
 '../../hooks/usePermission':{usePermission:key=>key==='proc-quality:manage'},
 '../../lib/procurementOperationsApi':{getQualityAnalysis:async()=>({record,analysis:record.analysis,people:[{id:'worker',name:'工人'}],suppliers:[],productionSource:null,receivedBatches:[]}),saveQualityAnalysis:async(id,input)=>{writes.push({id,...input});if(++attempts===1)throw Error('临时失败');}}
 });
 f.render();await flush();
 const labels=()=>nodes(f.render()).filter(row=>row.type==='label');
 const change=(label,value)=>{const field=labels().find(row=>text(row).startsWith(label));nodes(field).find(row=>['Input','Textarea','NativeSelect'].includes(row.type)).props.onChange({target:{value}});};
 change('主因类别','process');change('责任类型','internal');change('责任主体','worker');change('原因说明','工艺偏差');change('本次修改或确认依据','实物核对');
 nodes(f.render()).find(row=>row.type==='Button'&&text(row)==='确认主因与责任').props.onClick();await flush();
 assert.match(text(f.render()),/临时失败/);
 nodes(f.render()).find(row=>row.type==='Button'&&text(row)==='确认主因与责任').props.onClick();await flush();
 assert.equal(writes[0].baseUpdatedAt,record.updatedAt);assert.equal(writes[0].version,1);assert.equal(writes[0].requestId,writes[1].requestId);assert.equal(writes[0].data.responsibility.id,'worker');assert.equal(writes[0].data.defectiveQty,undefined);
});

