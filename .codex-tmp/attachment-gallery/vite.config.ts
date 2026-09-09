import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureFor } from '../../scripts/ui-preview/fixtures';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const auth=resolve(root,'src/app/auth');
export default defineConfig({
  root,envDir:dirname(fileURLToPath(import.meta.url)),envPrefix:'UI_PREVIEW_UNUSED_',
  define:{'import.meta.env.VITE_API_BASE':JSON.stringify(''),'import.meta.env.VITE_RECRUITMENT_API_BASE':JSON.stringify('')},
  plugins:[{name:'isolated-attachment-gallery',enforce:'pre',resolveId(source,importer){
    if(importer&&source.startsWith('.')&&resolve(dirname(importer.split('?')[0]),source).replace(/\.[jt]sx?$/,'')===auth)return resolve(root,'scripts/ui-preview/auth-preview.tsx');
  },configureServer(server){server.middlewares.use((request,response,next)=>{
    response.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws://127.0.0.1:5190; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
    const url=new URL(request.url||'/','http://127.0.0.1:5190');
    if(!['GET','HEAD'].includes(request.method||'')){response.writeHead(405,{'Content-Type':'application/json'});response.end(JSON.stringify({message:'本地附件验收禁止业务写入'}));return;}
    if(!url.pathname.startsWith('/api/')){next();return;}
    let data=fixtureFor(url.pathname,url.searchParams);
    if(url.pathname.endsWith('/messages')) data=[];
    if(url.pathname.endsWith('/messages/unread-count'))data={unread:0};
    response.writeHead(data===undefined?404:200,{'Content-Type':'application/json'});response.end(JSON.stringify(data??{message:'No local fixture'}));
  });}},react(),tailwindcss()],
  resolve:{dedupe:['react','react-dom'],alias:{'@':resolve(root,'src')}},server:{host:'127.0.0.1',port:5190,strictPort:true,fs:{allow:[root]}}
});

