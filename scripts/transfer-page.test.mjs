import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = (file) => readFileSync(new URL(`../src/app/production/transfer/${file}`,import.meta.url),'utf8');
const compile = (source) => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const primitives = new Proxy({}, {get:(_,key)=>key});
const jsx=(type,props,key)=>({type,props:props??{},key});
const translate=(value,params={})=>value.replace(/\{(\w+)\}/g,(match,key)=>params[key]??match);
const forbidden=()=>assert.fail('转产页面不得访问正式接口或持久化');
function evaluate(file,deps={},env={}) { const result={};new Function('exports','require','window','URL','fetch','localStorage',compile(read(file)))(result,(name)=>{
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };
assert.ok(Object.hasOwn(deps,name),`未经审查的依赖 ${name}`);return deps[name];},env.window??{},env.URL??URL,forbidden,new Proxy({},{get:forbidden,set:forbidden}));return result; }
const model=evaluate('transferModel.ts'),types=evaluate('transferTypes.ts');
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [...(tree.type?[tree]:[]),...Object.values(tree.props??{}).flatMap(nodes)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(typeof tree==='string'||typeof tree==='number')return String(tree);if(!tree||typeof tree!=='object')return '';return ['children','title','description','actions','action'].map((key)=>text(tree.props?.[key])).join(' ');}
const normalized=(tree)=>text(tree).replace(/\s+/g,' ').trim();
const shared={'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':primitives,'../../lib/i18n':{useI18n:()=>({t:translate})},'./transferModel':model,'./transferTypes':types};
function runtime(){const slots=[],effects=[];let cursor=0;return {slots,reset(){cursor=0;},effects,hooks:{
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],(value)=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useRef(initial){const index=cursor++;return slots[index]??={current:initial};},
  useCallback(callback,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={callback,deps};return slots[index].callback;},
  useEffect(effect,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){slots[index]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect();});}},
}};}
function fixture(initialSearch=''){
  const rt=runtime(),listeners=new Map(),downloads=[],scrolls=[];let tree,location=initialSearch,predicate,pending,exportFails=false;
  const blocker={state:'unblocked',reset(){pending=undefined;blocker.state='unblocked';},proceed(){location=pending;pending=undefined;blocker.state='unblocked';}};
  function navigate(next){if(predicate?.()) {pending=next;blocker.state='blocked';}else location=next;}
  const deps={...shared,react:rt.hooks,'react-router':{Link:'Link',useSearchParams:()=>[new URLSearchParams(location),(params)=>navigate(`?${params}`)],useBlocker:(next)=>{predicate=next;return blocker;}},'../../order-processing/components/HorizonPage':primitives,'./TransferActionForm':{TransferActionForm:'TransferActionForm'},'../../order-processing/horizon.css':{},'./transfer-preview.css':{}};
  for(const name of ['alert-dialog',"button","input",'label',"select",'sheet','tabs'])deps[`../../components/ui/${name}`]=primitives;
  const page=evaluate('TransferPreviewPage.tsx',deps,{window:{addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:(name)=>listeners.delete(name),matchMedia:()=>({matches:false}),requestAnimationFrame:(callback)=>callback(),setTimeout:(callback)=>callback(),document:{createElement(){const link={click(){downloads.push(link.download);}};return link;},getElementById:(id)=>({scrollIntoView:()=>scrolls.push(id)})}},URL:{createObjectURL(){if(exportFails)throw new Error('failed');return 'blob:local';},revokeObjectURL(){}}});
  const view={render(){rt.reset();tree=page.TransferPreviewPage();while(rt.effects.length)rt.effects.shift()();return tree;},nodes:()=>nodes(tree),text:()=>normalized(tree),form:()=>nodes(tree).find((node)=>node.type==='TransferActionForm'),state:()=>rt.slots.find((slot)=>slot?.records&&slot?.actors),params:()=>new URLSearchParams(location),downloads,
    byId:(id)=>nodes(tree).find((node)=>node.props.id===id),button:(label)=>nodes(tree).find((node)=>['Button','AlertDialogAction','AlertDialogCancel'].includes(node.type)&&normalized(node)===label),
    click(label){const button=view.button(label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,`${label} enabled`);button.props.onClick();view.render();},
    select(id,value){const node=nodes(tree).find((item)=>item.type==='Select'&&nodes(item).some((child)=>child.props.id===id));assert.ok(node,id);node.props.onValueChange(value);view.render();},
    tab(value){nodes(tree).find((node)=>node.type==='Tabs').props.onValueChange(value);view.render();},
    input(id,value){view.byId(id).props.onChange({target:{value}});view.render();},
    dirty(){view.form().props.onDirtyChange(true);view.render();},
    dialog(label){return nodes(tree).find((node)=>node.type==='AlertDialog'&&normalized(node).includes(label));},
    failNext(){nodes(tree).find((node)=>node.type === "Checkbox").props.onCheckedChange(true);view.render();},
    failExport(){exportFails=true;},
    inputAction(patch={}){const props=view.form().props,kind=props.context.kind;return {recordId:props.record.id,actorId:props.actorId,kind,...({document:{documentId:props.context.targetId,revision:'V1.3',summary:'已核对新版本适用范围',published:true},trial:{date:'2026-09-14',quantity:3,passed:true,result:'完成指定数量的验证，全部符合要求',evidence:[]},confirm:{reviewed:true,note:'已核对本人岗位转产条件'},submit:{reviewed:true,note:'确认本批条件齐备，可提交转产'}}[kind]??{}),...patch};},
    async save(patch={}){try{await view.form().props.onSubmit(view.inputAction(patch));}finally{view.render();}},
    unload(){const event={prevented:false,preventDefault(){this.prevented=true;}};listeners.get('beforeunload')?.(event);return event.prevented;},
    navigate(next){navigate(next);view.render();},
  };view.render();return view;
}
test('默认资料未齐阻止试装；只读与岗位限制从界面入口执行',()=>{const page=fixture();assert.match(page.text(),/Q7 智能控制器/);assert.equal(page.button('保存试装记录').props.disabled,true);assert.equal(page.button('提交转产确认'),undefined);page.select('tp-actor','quality-a');assert.equal(page.button('补充资料'),undefined);assert.equal(page.button('保存试装记录'),undefined);page.select('tp-actor','viewer-a');assert.equal(page.button('完成本人岗位确认'),undefined);assert.match(page.text(),/只读/);});
test('补资料更新当前快照；错误对象被拒绝；模拟保存失败可重试且仅写一次',async()=>{const page=fixture();const docs=page.state().records[0].documents;const row=page.nodes().find((node)=>node.type==='tr'&&normalized(node).includes('ECN'));nodes(row).find((node)=>node.type==='Button'&&normalized(node)==='补充资料').props.onClick();page.render();page.dirty();const before=page.state();await assert.rejects(page.save({documentId:docs[0].id}),/不一致/);assert.equal(page.state(),before);page.failNext();await assert.rejects(page.save(),/填写内容已保留/);assert.equal(page.state(),before);assert.ok(page.form());await page.save();assert.equal(page.state().records[0].basisVersion,2);assert.equal(page.state().records[0].events.length,1);assert.equal(page.form(),undefined);assert.equal(page.button('保存试装记录').props.disabled,false);});
test('dirty 状态切换岗位可取消，确认放弃保留批次且旧回调失效',async()=>{const page=fixture('?transfer=transfer-2');page.click('保存试装记录');page.dirty();assert.equal(page.unload(),true);const saved=page.form().props.onSubmit,input=page.inputAction();page.select('tp-actor','quality-a');assert.equal(page.dialog('放弃尚未保存').props.open,true);assert.equal(page.form().props.actorId,'process-a');page.dialog('放弃尚未保存').props.onOpenChange(false);page.render();assert.ok(page.form());page.select('tp-actor','quality-a');page.click('放弃并继续');assert.equal(page.form(),undefined);assert.equal(page.params().get('transfer'),'transfer-2');await assert.rejects(saved(input),/已变化/);assert.equal(page.state().records[1].trials.length,1);});
test('dirty 表单阻止外部导航，取消后继续，放弃后离开',()=>{const page=fixture('?transfer=transfer-2');page.click('保存试装记录');page.dirty();page.navigate('?transfer=transfer-3');assert.equal(page.dialog('离开当前转产').props.open,true);assert.equal(page.params().get('transfer'),'transfer-2');const dialog=page.dialog('离开当前转产');nodes(dialog).find((node)=>node.type==='AlertDialogCancel').props.onClick();page.render();assert.ok(page.form());page.navigate('?transfer=transfer-3');page.click('放弃并离开');assert.equal(page.params().get('transfer'),'transfer-3');assert.equal(page.form(),undefined);});
test('负责人提交已齐套记录，准备中筛选切为全部，保留确认后对象并锁定',async()=>{const page=fixture();page.select('tp-status','preparing');page.select('tp-record','transfer-2');page.select('tp-actor','lead-a');assert.equal(page.button('提交转产确认').props.disabled,false);page.click('提交转产确认');await page.save();assert.equal(page.state().records[1].status,'confirmed');assert.equal(page.params().get('transfer'),'transfer-2');assert.equal(page.params().get('tab'),'history');assert.match(page.text(),/批次依据已锁定/);assert.equal(page.button('提交转产确认'),undefined);assert.equal(page.button('导出转产记录').props.disabled,false);page.click('导出转产记录');assert.equal(page.downloads.length,1);});
test('筛选空结果、无效链接和读取失败有恢复操作，导出失败不改变数据',()=>{const page=fixture('?transfer=missing');assert.equal(page.button('导出转产记录').props.disabled,true);page.click('清除筛选');assert.match(page.text(),/Q7 智能控制器/);page.input('tp-query','没有匹配');assert.match(page.text(),/当前范围没有转产记录/);page.click('清除筛选');page.click('读取失败');assert.match(page.text(),/转产资料读取失败/);page.click('重新读取');const before=page.state();page.failExport();page.click('导出转产记录');assert.match(page.text(),/导出失败/);assert.equal(page.state(),before);});
test('真实操作表单保存失败后保留意见并允许重试',async()=>{
  const rt=runtime();let tree,attempt=0;const submitted=[];const props={record:model.createTransferState().records[1],actorId:'lead-a',context:{kind:'submit',recordId:'transfer-2'},onDirtyChange(){},onCancel(){},async onSubmit(input){attempt++;if(attempt===1)throw new Error('演示保存失败，填写内容已保留，请重试。');submitted.push(input);}};
  const deps={...shared,react:rt.hooks};for(const name of ['button','input','label'])deps[`../../components/ui/${name}`]=primitives;
  const form=evaluate('TransferActionForm.tsx',deps);const render=()=>{rt.reset();tree=form.TransferActionForm(props);return tree;};render();
  nodes(tree).find((node)=>node.props.id==='tp-note').props.onChange({target:{value:'负责人核对完成，可转产。'}});render();nodes(tree).find((node)=>node.type === "Checkbox").props.onCheckedChange(true);render();
  await tree.props.onSubmit({preventDefault(){}});render();assert.match(normalized(tree),/填写内容已保留/);assert.equal(nodes(tree).find((node)=>node.props.id==='tp-note').props.value,'负责人核对完成，可转产。');assert.equal(nodes(tree).find((node)=>node.type === "Checkbox").props.checked,true);
  await tree.props.onSubmit({preventDefault(){}});render();assert.equal(submitted.length,1);assert.equal(submitted[0].note,'负责人核对完成，可转产。');assert.equal(submitted[0].reviewed,true);
});
