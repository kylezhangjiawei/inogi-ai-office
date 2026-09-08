// 独立 UI 验收：仅本机、合成资料、内存写入，没有业务 API 代理或数据库连接。
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import JSZip from 'jszip';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = Array.from({ length: 42 }, (_, i) => ({ id: `file${i}`, name: i === 0 ? '产品外观图_最终确认版本_中英文资料.png' : `项目资料-${String(i + 1).padStart(2, '0')}.${i % 2 ? 'pdf' : 'png'}`, folder: `研发/产品A/任务${i % 3 + 1}`, size: 128000 + i * 1000, source: 'task' }));
const jobs = [];
const selections = new Map();
let seq = 0;
const main = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MateChatArchives} from '/src/app/components/matechat/MateChatArchives.tsx'; import '/src/styles/index.css';
createRoot(document.getElementById('root')).render(<React.StrictMode><main style={{maxWidth:760,margin:'32px auto',padding:16}}><p style={{fontSize:12,color:'#64748b'}}>独立验收环境 · 全部为合成资料</p><h1 style={{fontSize:24,margin:'12px 0'}}>MateChat 资料打包</h1><MateChatArchives conversationId="preview" active={true} refreshKey={0}/></main></React.StrictMode>);`;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MateChat 资料打包验收</title></head><body><div id="root"></div><script type="module" src="/__archive_preview.tsx"></script></body></html>';
const server = await createServer({ root, configFile: false, envDir: '/private/tmp', envPrefix: 'ARCHIVE_PREVIEW_UNUSED_',
  plugins: [{ name: 'archive-synthetic-preview', enforce: 'pre',
    resolveId(id) { if (id === '/__archive_preview.tsx') return id; },
    load(id) { if (id === '/__archive_preview.tsx') return main; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1:5176');
        const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
        try {
          if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/', html)); return; }
          if (!url.pathname.startsWith('/api/')) return next();
          let body = {};
          if (req.method === 'POST') { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 100000) return send({ message: '请求过大' }, 413); } body = JSON.parse(raw || '{}'); }
          const path = url.pathname.replace('/api/chat/', '');
          if (path === 'files/search') {
            const filtered = files.filter((file) => !body.query || file.name.includes(body.query));
            const id = `selection${++seq}`; selections.set(id, filtered);
            return send({ selectionId: id, total: filtered.length, files: filtered.slice(0, 30), hasMore: filtered.length > 30, warnings: [] });
          }
          if (path === 'conversations/preview/file-selections') return send([...selections].reverse().slice(0, 5).map(([selectionId, value]) => ({ selectionId, total: value.length })));
          if (path.startsWith('file-selections/')) { const id = path.split('/')[1], value = selections.get(id); if (!value) return send({ message: '检索已过期' }, 404); const offset = Number(url.searchParams.get('offset') || 0); return send({ selectionId: id, total: value.length, files: value.slice(offset, offset + 100), warnings: [] }); }
          if (path === 'archives' && req.method === 'POST') {
            const chosen = body.selection_ids.flatMap((id) => selections.get(id) || []).filter((f) => !body.file_ids || body.file_ids.includes(f.id));
            const job = { id: `job${++seq}`, filename: `${body.filename || '项目资料'}.zip`, status: 'queued', total: chosen.length, processed: 0, succeeded: 0, failed: 0, bytes: 512000, cancelRequested: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), files: chosen };
            jobs.unshift(job); return send(job);
          }
          if (path === 'conversations/preview/archives') {
            for (const job of jobs) if (['queued', 'running'].includes(job.status)) { job.status = 'running'; job.processed = Math.min(job.total, job.processed + 8); job.succeeded = job.processed; if (job.processed === job.total) job.status = 'succeeded'; }
            return send(jobs);
          }
          if (path.startsWith('archives/')) {
            const [, id, verb] = path.split('/'), job = jobs.find((j) => j.id === id);
            if (!job) return send({ message: '任务不存在' }, 404);
            if (verb === 'cancel') { job.status = 'canceled'; return send(job); }
            if (verb === 'retry') { job.status = 'queued'; job.processed = 0; return send(job); }
            if (verb === 'download') return send({ url: `http://127.0.0.1:5176/api/chat/archives/${id}/zip`, filename: job.filename });
            if (verb === 'zip') { const zip = new JSZip(); zip.file('合成验收资料.txt', 'This ZIP contains synthetic test data only.'); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="preview.zip"' }); res.end(await zip.generateAsync({ type: 'nodebuffer' })); return; }
            return send({ rows: job.files.map((file) => ({ ...file, path: `${file.folder}/${file.name}`, status: 'ok' })), nextOffset: null });
          }
          return send({ message: '独立验收环境：未接入任何真实业务接口' }, 404);
        } catch (error) { send({ message: error.message }, 500); }
      });
    },
  }, react(), tailwindcss()],
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(''), 'import.meta.env.VITE_RECRUITMENT_API_BASE': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
});
await server.listen(); server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
