import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router';
import {TooltipProvider} from '/src/app/components/ui/tooltip';
import {ProcurementTaskCard} from '/src/app/procurement/components/ProcurementTaskCard';
import {TaskDetailDrawer} from '/src/app/procurement/components/TaskDetailDrawer';
import {AttachmentPreviewDialog} from '/src/app/components/AttachmentPreviewDialog';
import {tasks,materials} from '/scripts/ui-preview/fixtures';
import '/src/styles/index.css';
import '/src/app/procurement/horizon.css';

const file=(id:string,fileName:string,mimeType:string,fileUrl:string)=>({id,fileName,mimeType,fileUrl,fileSize:12800});
const attachmentList=[
 file('a1','01-设备整体横向图.svg','image/svg+xml','./wide.svg'),
 file('a2','02-从顶部到底部全部可见的长图.svg','image/svg+xml','./tall.svg'),
 file('a3','03-透明背景组件.png','image/png','./transparent.png'),
 file('a4','04-卡片隐藏的装配示意图.svg','image/svg+xml','./hidden.svg'),
 file('a5','05-卡片隐藏的图片加载失败.png','image/png','./broken.png'),
 file('a6','06-完整技术说明.pdf','application/pdf','./sample.pdf'),
 file('a7','07-采购验收说明.txt','text/plain','./sample.txt'),
 file('a8','08-最后一张隐藏的总装照片.svg','image/svg+xml','./last.svg'),
];
const task={...tasks[6],id:'attachment-gallery-test',code:'QA-ATTACHMENT-008',materialName:'Q5 外壳与组件图纸附件验收',rdTaskTitle:'Q5 包材与整机装配',buyer:'采购测试人员',rdContact:'研发测试人员',quantity:60,arrivedQty:0,attachmentList,attachments:attachmentList.length,logs:[{at:new Date().toISOString(),text:'本地虚构验收任务：包含横图、长图、透明图片、隐藏附件和不同文件格式。'}]};
function Harness(){
 const [drawer,setDrawer]=useState(false);const [single,setSingle]=useState(false);
 return <div className="horizon-theme proc-horizon" style={{minHeight:'100dvh',padding:16,background:'#f4f6fc'}}>
 <h1 style={{fontSize:22,fontWeight:700,marginBottom:8}}>供应链附件预览 · 本地验收</h1>
 <p style={{marginBottom:12,color:'#64748b'}}>仅虚构资料；8 个附件，卡片折叠显示前三个。</p>
 <div style={{display:'flex',gap:12,marginBottom:16}}><button id="open-drawer" className="rounded-lg border bg-white px-3 py-2" onClick={()=>setDrawer(true)}>打开任务详情</button><button id="open-single" className="rounded-lg border bg-white px-3 py-2" onClick={()=>setSingle(true)}>打开单附件兼容预览</button></div>
 <div style={{maxWidth:600}}><ProcurementTaskCard task={task as any} materials={materials} onOpen={()=>setDrawer(true)} onNext={()=>{}}/></div>
 {drawer&&<TaskDetailDrawer task={task as any} onClose={()=>setDrawer(false)}/>}
 {single&&<AttachmentPreviewDialog attachment={{id:'single',name:'单附件长图.svg',mime:'image/svg+xml',url:'./tall.svg'}} onClose={()=>setSingle(false)}/>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><TooltipProvider><Harness/></TooltipProvider></MemoryRouter>);
