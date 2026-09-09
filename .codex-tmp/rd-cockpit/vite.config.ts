import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import tailwindcss from '@tailwindcss/vite';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {fixtureFor} from '../../scripts/ui-preview/fixtures';import {categories,people,taskList,attachments,notes} from './fixture-data';
const dir=dirname(fileURLToPath(import.meta.url));const root=resolve(dir,'../..');const auth=resolve(root,'src/app/auth');
export default defineConfig({root,envDir:dir,envPrefix:'UI_PREVIEW_UNUSED_',define:{'import.meta.env.VITE_API_BASE':JSON.stringify(''),'import.meta.env.VITE_RECRUITMENT_API_BASE':JSON.stringify('')},plugins:[{name:'rd-cockpit-preview',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')&&resolve(dirname(importer.split('?')[0]),source).replace(/\.[jt]sx?$/,'')===auth)return resolve(root,'scripts/ui-preview/auth-preview.tsx');},configureServer(server){server.middlewares.use((req,res,next)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws://127.0.0.1:5190; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");const url=new URL(req.url||'/','http://127.0.0.1:5190');const p=url.pathname;const send=(data:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.method==='POST'&&/^\/api\/research-development\/task-progress-notes\/QA-RD-\d+\/read$/.test(p)){send({ok:true});return;}
 if(!['GET','HEAD'].includes(req.method||'')){send({message:'本地研发验收禁止业务写入'},405);return;}if(!p.startsWith('/api/')){next();return;}
 if(/\/(task-categories|cockpit-task-categories|member-task-categories|merged-task-categories)$/.test(p)||p.includes('/product-task-categories/')){send(categories);return;}
 if(p==='/api/research-development/people'){send(people);return;}
 if(p.includes('/task-attachment-previews')){send(Object.fromEntries(taskList.map(t=>[t.task_id,{attachment_count:12,attachments:attachments.slice(0,5)}])));return;}
 if(p.includes('/task-attachments/')){send({attachment_count:12,attachments});return;}
 if(p.includes('/task-progress-note-groups/')){const id=p.split('/').pop()!;send({current_task_id:id,tasks:[{task_id:id,title:taskList.find(t=>t.task_id===id)?.title,parent_task_id:null,path:[],joined_at:null}],notes:notes(id)});return;}
 if(p.includes('/task-progress-notes/')){send(notes(p.split('/').pop()!));return;}
 if(p.includes('/task-completion-scores')){send(p.includes('/task-completion-scores/')?null:{});return;}
 if(p.endsWith('/note-unread-summary')||p.endsWith('/task-note-receipts')){send({});return;}
 if(p.includes('/production-task-syncs')||p.includes('/daily-reports')||p.includes('/audit-logs')||p.includes('/messages')||p.includes('/discussions')){send([]);return;}
 const data=fixtureFor(p,url.searchParams);send(data??{message:'No local fixture'},data===undefined?404:200);
 });}},react(),tailwindcss()],resolve:{dedupe:['react','react-dom'],alias:{'@':resolve(root,'src')}},server:{host:'127.0.0.1',port:5190,strictPort:true,fs:{allow:[root]}}});
