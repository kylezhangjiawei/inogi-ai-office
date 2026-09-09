import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router';
import {Header} from '/src/app/components/header_1';
import {Sheet} from '/src/app/components/ui/sheet';
import {TaskDetailDrawer} from '/src/app/procurement/components/TaskDetailDrawer';
import {tasks} from '/scripts/ui-preview/fixtures';
import '/src/styles/index.css';
import '/src/app/procurement/horizon.css';
function Harness(){
  const route=useLocation();const [open,setOpen]=useState(true);const [stage,setStage]=useState('');
  const mode=new URLSearchParams(location.search).get('mode')||'header';
  const task={...tasks[9],status:new URLSearchParams(location.search).get('completed')==='1'?'completed':'partial_arrival',rdTaskId:'MOCK-RD-001'};
  function compose(kind:string){
    const input=document.querySelector('input[type="search"]') as HTMLInputElement;input.focus();
    if(kind==='start') {input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'yan fa');input.dispatchEvent(new Event('input',{bubbles:true}));setStage('组词中');}
    else {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'研发');input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'研发'}));input.dispatchEvent(new Event('input',{bubbles:true}));setStage('选字完成');}
  }
  return <div className="horizon-theme" style={{minHeight:'100dvh'}}><p style={{padding:12}}>本地虚构数据验收，服务端禁止写入</p>{mode==='header'?<><Sheet><Header/></Sheet><div style={{padding:12}}><button onClick={()=>compose('start')}>模拟开始中文组词</button> · <button onClick={()=>compose('end')}>模拟选定中文</button><output id="compose-state">{stage}</output><pre id="current-route">{route.pathname+route.search}</pre></div></>:<><button onClick={()=>setOpen(true)}>打开采购任务</button>{open&&<TaskDetailDrawer task={task as any} onClose={()=>setOpen(false)}/>}</>}</div>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/rd-task-management']}><Harness/></MemoryRouter>);
