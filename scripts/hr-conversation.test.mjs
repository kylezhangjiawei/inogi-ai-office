import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const jsx=(type,props)=>({type,props:props||{}});
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props.children);
function host(){
  let cursor=0;const values=[],out={};
  const deps={react:{useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useRef(initial){const i=cursor++;values[i]??={current:initial};return values[i];},useEffect(){}},'react/jsx-runtime':{jsx,jsxs:jsx},'react-router':{Link:'Link'},'lucide-react':{},'./peopleLogic':{isHr:r=>['人力负责人','员工关系岗'].includes(r),personId:r=>r.fields['人员编号']||r.id},'./WorkViews':{Badge:'Badge',Notice:'Notice',Select:'Select'}};
  const source=readFileSync(new URL('../src/app/hr/ConversationViews.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('exports','require',code+'\nexports.Subject=KnowledgeAssistant;')(out,dep=>{if(dep.includes('/components/'))return new Proxy({},{get:(_,key)=>key});assert.ok(dep in deps,dep);return deps[dep];});
  return p=>{cursor=0;return out.Subject({p});};
}
function fixture(){
  const tickets=['打印机如何连接？','停车位如何办理？'].map((question,i)=>({id:`Q-${i}`,title:question,fields:{问题:question,人员编号:'E-001'},status:'待人工回复'}));
  const updates=[],adds=[];
  return {role:'人力负责人',employeeId:'E-001',all:{assistant:tickets,archive:[]},department:'研发部',notify(){},updateModule:(...args)=>updates.push(args),add:(...args)=>adds.push(args),updates,adds};
}
const reply=(tree,question)=>nodes(tree).find(n=>n.type==='Textarea'&&n.props['aria-label']===`回复咨询：${question}`);

test('人工咨询回复草稿按记录隔离，保存一条不清空另一条',()=>{
  const render=host(),p=fixture(),[a,b]=p.all.assistant;
  reply(render(p),a.fields['问题']).props.onChange({target:{value:'打印机答复'}});
  assert.equal(reply(render(p),b.fields['问题']).props.value,'');
  reply(render(p),b.fields['问题']).props.onChange({target:{value:'停车位答复'}});
  const article=nodes(render(p)).find(n=>n.type==='article'&&text(n).includes(a.fields['问题']));
  nodes(article).find(n=>n.type==='Button'&&text(n)==='登记人工回复（演示）').props.onClick();
  assert.equal(p.updates[0][1],a.id);
  assert.equal(p.updates[0][2].fields['人工回复'],'打印机答复');
  assert.equal(reply(render(p),b.fields['问题']).props.value,'停车位答复');
});

test('首尾空白不生成重复人工咨询，并在当前消息标出排队状态',()=>{
  const render=host(),p=fixture();
  const send=query=>{nodes(render(p)).find(n=>n.type==='Input').props.onChange({target:{value:query}});nodes(render(p)).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});};
  send('  打印机如何连接？  ');
  const tree=render(p),handoff=nodes(tree).find(n=>n.type==='Button'&&/人工队列|转人工/.test(text(n)));
  assert.equal(handoff.props.disabled,true);
  assert.match(text(handoff),/已进入人工队列/);
  assert.equal(p.adds.length,0);
});
