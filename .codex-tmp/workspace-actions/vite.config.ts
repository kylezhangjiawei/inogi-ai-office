import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureFor,tasks,previewUser} from '../../scripts/ui-preview/fixtures';
const dir=dirname(fileURLToPath(import.meta.url));const root=resolve(dir,'../..');const auth=resolve(root,'src/app/auth');
const demo=tasks.slice(6,9).map((task,index)=>({...task,id:`workspace-qa-${index+1}`,code:`QA-WORK-${index+1}`,buyer:'采购验收员',buyerUserId:previewUser.id,materialName:['回退验收组件','在途验收组件','已完成验收组件'][index],spec:'Q5 / 合成资料',status:['priced','in_transit','completed'][index],quantity:10,arrivedQty:index===2?10:0,attachmentList:[],logs:[{id:'qa-initial',at:'09-08 10:32',createdAt:'2026-09-08T02:32:45.000Z',actor:'研发验收员',fromStatus:'testing',toStatus:'priced',text:'技术验收已确认通过，等待采购安排下单。'}]}));
export default defineConfig({root,envDir:dir,envPrefix:'UI_PREVIEW_UNUSED_',define:{'import.meta.env.VITE_API_BASE':JSON.stringify(''),'import.meta.env.VITE_RECRUITMENT_API_BASE':JSON.stringify('')},plugins:[{name:'workspace-actions-preview',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')&&resolve(dirname(importer.split('?')[0]),source).replace(/\.[jt]sx?$/,'')===auth)return resolve(dir,'auth-preview.tsx');},configureServer(server){server.middlewares.use(async(req,res,next)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws://127.0.0.1:5190; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
 const url=new URL(req.url||'/','http://127.0.0.1:5190');const send=(data:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.method==='POST'&&/^\/api\/procurement\/tasks\/workspace-qa-[12]\/rollback$/.test(url.pathname)){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);const task=demo.find(x=>url.pathname.includes('/'+x.id+'/'))!;if(!input.reason?.trim()||input.reason.trim().length<2){send({message:'本地模拟：回退原因必填'},400);return;}const old=task.status;task.status=input.status;task.logs.push({id:'qa-rollback',at:'09-08 16:05',createdAt:'2026-09-08T08:05:42.000Z',actor:'采购验收员',fromStatus:old,toStatus:input.status,text:`回退原因：${input.reason}`});send(task);return;}
 if(!['GET','HEAD'].includes(req.method||'')){send({message:'本地夹具禁止非模拟业务写入'},405);return;}
 if(!url.pathname.startsWith('/api/')){next();return;}
 if(url.pathname==='/api/procurement/tasks'){send({items:demo,total:demo.length,page:1,pageSize:200});return;}
 if(/^\/api\/procurement\/tasks\/workspace-qa-/.test(url.pathname)){send(demo.find(x=>url.pathname.endsWith('/'+x.id))??{},200);return;}
 if(url.pathname==='/api/procurement/quotations'){send([]);return;}
 const data=fixtureFor(url.pathname,url.searchParams);send(data??{message:'No local fixture'},data===undefined?404:200);
 });}},react(),tailwindcss()],resolve:{dedupe:['react','react-dom'],alias:{'@':resolve(root,'src')}},server:{host:'127.0.0.1',port:5190,strictPort:true,fs:{allow:[root]}}});
