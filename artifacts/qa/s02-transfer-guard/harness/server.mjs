import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { drawingPdf, initialTasks, makeProcTask, notesText, products, user } from './fixtures.mjs';
import { extractWorkspaceModalLayer, workspaceLayerResolvedId, workspaceLayerVirtualId } from './workspace-layer-source.mjs';

const project = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const preview = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${project}/package.json`);
const { createServer } = await import(require.resolve('vite'));
const modes = new Set(['success', 'error', 'error-once', 'slow']);
const config = { transferMode: 'success', uploadMode: 'success', documentsMode: 'success' };
const counts = { submit: 0, upload: 0, put: 0, register: 0, abort: 0, documents: 0, products: 0, linked: 0 };
const requests = [];
const submissions = [];
const uploaded = new Map();
let uploadSequence = 0;
let activeRequests = 0;
// Retain completed QA counters/records when enabling the extracted layer module.
// Uploaded bytes stay process-local; the archived snapshot records earlier upload metadata.
const preservedPath = `${preview}/qa-before-nested-restart.json`;
const preservedQa = existsSync(preservedPath) ? JSON.parse(readFileSync(preservedPath, 'utf8')) : null;
if (preservedQa?.state) {
  for (const key of Object.keys(counts)) if (Number.isSafeInteger(preservedQa.state.counts?.[key])) counts[key] = preservedQa.state.counts[key];
  for (const key of Object.keys(config)) if (modes.has(preservedQa.state.config?.[key])) config[key] = preservedQa.state.config[key];
  requests.push(...(preservedQa.state.requests || []));
  submissions.push(...(preservedQa.state.submissions || []));
  uploadSequence = Math.max(0, ...(preservedQa.state.uploaded || []).map((entry) => Number(entry.id?.split('-').at(-1)) || 0));
}
const readBuffer = async (req, limit = 10 * 1024 * 1024) => {
  const buffers = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw new Error('隔离测试文件不能超过 10 MB'); buffers.push(chunk); }
  return Buffer.concat(buffers);
};
const readJson = async (req) => { const bytes = await readBuffer(req, 128 * 1024); return bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; };
async function modeError(key) {
  const mode = config[key];
  if (mode === 'error-once') config[key] = 'success';
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 3000));
  return mode === 'error' || mode === 'error-once';
}
const plugin = {
  name: 's02-transfer-guard-memory-only', enforce: 'pre',
  configResolved(value) { value.server.proxy = undefined; },
  resolveId(source, importer) {
    if (source === workspaceLayerVirtualId) return workspaceLayerResolvedId;
    if (!importer || (!source.startsWith('.') && !source.startsWith('/'))) return null;
    const candidate = resolve(dirname(importer.split('?')[0]), source).replace(/\.[jt]sx?$/, '');
    if (candidate === `${project}/src/app/auth`) return `${preview}/auth-preview.tsx`;
    if (candidate === `${project}/src/app/lib/authSession`) return `${preview}/auth-session-preview.ts`;
    return null;
  },
  load(id) {
    if (id !== workspaceLayerResolvedId) return null;
    const extracted = extractWorkspaceModalLayer(project);
    this.addWatchFile(extracted.filename);
    return extracted.code;
  },
  handleHotUpdate(context) {
    if (context.file !== `${project}/src/app/RDMyWorkspacePage.tsx`) return;
    const module = context.server.moduleGraph.getModuleById(workspaceLayerResolvedId);
    if (!module) return;
    context.server.moduleGraph.invalidateModule(module);
    return [...context.modules, module];
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws://127.0.0.1:4185 ws://localhost:4185; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
      const url = new URL(req.url || '/', 'http://127.0.0.1:4185');
      const path = url.pathname;
      const method = req.method || 'GET';
      const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Inogi-Fixture': 'S02-memory-only' }); res.end(JSON.stringify(data)); };
      const fileResponse = (body, mime, name) => { res.writeHead(200, { 'Content-Type': mime, 'Content-Length': Buffer.byteLength(body), 'Content-Disposition': `inline; filename="${name}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(body); };
      try {
        if (path === '/__qa/s02-transfer-guard' && method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>S02 转采购保护 · 隔离验证</title></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@fs${preview}/preview.tsx"></script></body></html>`);
          return;
        }
        if (path === '/__qa/health' && method === 'GET') return send({ ok: true, fixture: 'S02', apiMode: 'memory-only', config, counts, activeRequests, preservedQa: preservedQa ? { capturedAt: preservedQa.capturedAt, file: 'qa-before-nested-restart.json' } : null, requests, submissions, uploaded: [...uploaded.values()].map(({ bytes, ...entry }) => ({ ...entry, uploadedBytes: bytes?.length || 0 })) });
        if (path === '/__qa/workspace-layer-source' && method === 'GET') return send(extractWorkspaceModalLayer(project).provenance);
        if (path === '/__qa/config' && method === 'POST') {
          const input = await readJson(req);
          for (const [key, value] of Object.entries(input)) if (!(key in config) || !modes.has(value)) return send({ message: '未知夹具配置' }, 400);
          Object.assign(config, input); return send({ config });
        }
        if (path === '/__qa/reset-counts' && method === 'POST') {
          if (activeRequests) return send({ message: '尚有内存模拟请求进行中，请稍后清零。' }, 409);
          for (const key of Object.keys(counts)) counts[key] = 0;
          requests.length = 0; submissions.length = 0; return send({ counts });
        }
        if (path === '/__qa/reset' && method === 'POST') {
          if (activeRequests) return send({ message: '尚有内存模拟请求进行中，请稍后重置。' }, 409);
          for (const key of Object.keys(counts)) counts[key] = 0;
          for (const key of Object.keys(config)) config[key] = 'success';
          requests.length = 0; submissions.length = 0; uploaded.clear(); uploadSequence = 0;
          return send({ counts, config });
        }
        if (path === '/__qa/files/drawing.pdf' && method === 'GET') return fileResponse(drawingPdf(), 'application/pdf', 's02-test-drawing.pdf');
        if (path === '/__qa/files/notes.txt' && method === 'GET') return fileResponse(notesText, 'text/plain; charset=utf-8', 's02-test-notes.txt');
        const putMatch = path.match(/^\/__qa\/upload\/([^/]+)$/);
        if (putMatch && method === 'PUT') {
          const entry = uploaded.get(decodeURIComponent(putMatch[1]));
          if (!entry) return send({ message: '本地上传申请不存在' }, 404);
          counts.put += 1; const bytes = await readBuffer(req);
          if (bytes.length !== entry.fileSize) return send({ message: '上传大小与申请不一致' }, 400);
          entry.bytes = bytes; return send({ ok: true });
        }
        const uploadedMatch = path.match(/^\/__qa\/uploaded\/([^/]+)$/);
        if (uploadedMatch && method === 'GET') {
          const entry = uploaded.get(decodeURIComponent(uploadedMatch[1]));
          if (!entry?.registered || !entry.bytes) return send({ message: '本地文件不存在' }, 404);
          // Download only: a selected local HTML or SVG file must not execute in the fixture origin.
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="qa-upload.bin"', 'Content-Length': entry.bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
          res.end(entry.bytes); return;
        }
        if (path.startsWith('/__qa/')) return send({ message: '隔离验证未注册此路径' }, 404);
        if (!path.startsWith('/api/')) return next();
        requests.push({ method, path, at: new Date().toISOString(), authorization: Boolean(req.headers.authorization) });
        if (requests.length > 200) requests.shift();
        if (method === 'GET' && path === '/api/auth/me') return send({ user });
        if (method === 'GET' && path === '/api/research-development/products') { counts.products += 1; return send(products); }
        if (method === 'GET' && path === '/api/procurement/tasks' && url.searchParams.get('rdLink') === 'true') {
          const taskId = url.searchParams.get('rdTaskId');
          if (taskId !== initialTasks.fresh.taskId || url.searchParams.get('pageSize') !== '1') return send({ message: '未知隔离研发关联范围' }, 404);
          counts.linked += 1; activeRequests += 1;
          try {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const task = { ...makeProcTask({ rdTaskId: taskId, rdTaskTitle: initialTasks.fresh.taskTitle, materialName: '其他会话已生成的隔离需求' }), id: 'qa-s02-late-existing', code: 'CG-S02-QA-LATE' };
            return send({ items: [task], total: 1, page: 1, pageSize: 1 });
          } finally { activeRequests -= 1; }
        }
        const documentMatch = path.match(/^\/api\/research-development\/tasks\/([^/]+)\/technical-documents$/);
        if (documentMatch && method === 'GET') {
          const taskId = decodeURIComponent(documentMatch[1]);
          if (!Object.values(initialTasks).some((task) => task.taskId === taskId)) return send({ message: '未知隔离研发任务' }, 404);
          counts.documents += 1; activeRequests += 1;
          try { if (await modeError('documentsMode')) return send({ message: '隔离验证：技术资料读取失败，请重新加载。' }, 503); return send({ canEdit: false, documents: [] }); }
          finally { activeRequests -= 1; }
        }
        if (path === '/api/files/presign-upload' && method === 'POST') {
          const input = await readJson(req); counts.upload += 1; activeRequests += 1;
          try {
            if (await modeError('uploadMode')) return send({ message: '隔离验证：新增附件上传失败，请重试。' }, 503);
            if (input.businessType !== 'assets' || typeof input.fileName !== 'string' || !Number.isSafeInteger(input.fileSize) || input.fileSize < 0 || input.fileSize > 10 * 1024 * 1024) return send({ message: '非法本地上传描述' }, 400);
            const id = `qa-s02-upload-${++uploadSequence}`;
            const objectKey = `qa-s02/uploads/${id}`;
            uploaded.set(id, { id, objectKey, fileName: input.fileName, mimeType: input.mimeType || 'application/octet-stream', fileSize: input.fileSize, registered: false });
            return send({ objectKey, putUrl: `/__qa/upload/${id}`, contentType: input.mimeType || 'application/octet-stream', cacheControl: 'no-store' });
          } finally { activeRequests -= 1; }
        }
        if (path === '/api/files/register-upload' && method === 'POST') {
          counts.register += 1; const input = await readJson(req); const entry = [...uploaded.values()].find((value) => value.objectKey === input.objectKey);
          if (!entry?.bytes || input.fileName !== entry.fileName || input.fileSize !== entry.fileSize) return send({ message: '本地上传登记不匹配' }, 400);
          entry.registered = true;
          return send({ fileId: entry.id, objectKey: entry.objectKey, fileName: entry.fileName, mimeType: entry.mimeType, fileSize: entry.fileSize, signedUrl: `/__qa/uploaded/${entry.id}`, expiresIn: 3600 });
        }
        if (path === '/api/files/abort-upload' && method === 'POST') {
          counts.abort += 1; const input = await readJson(req); const entry = [...uploaded.values()].find((value) => value.objectKey === input.objectKey);
          if (entry && !entry.registered) uploaded.delete(entry.id); return send({ ok: true });
        }
        if (path === '/api/procurement/tasks/transfer' && method === 'POST') {
          counts.submit += 1; const count = counts.submit; const input = await readJson(req); submissions.push({ count, input, at: new Date().toISOString() }); activeRequests += 1;
          try {
            if (await modeError('transferMode')) return send({ message: '隔离验证：生成采购任务失败，请保留表单后重试。' }, 503);
            if (!Object.values(initialTasks).some((task) => task.taskId === input.rdTaskId) || !input.materialName?.trim() || !(input.quantity > 0) || !Array.isArray(input.attachments) || !input.attachments.length) return send({ message: '隔离提交校验失败' }, 400);
            if (input.attachments.some((file) => !String(file.fileUrl).startsWith('/__qa/'))) return send({ message: '仅接收本地测试文件地址' }, 400);
            return send(makeProcTask(input, count));
          } finally { activeRequests -= 1; }
        }
        // No backend proxy: even unregistered writes terminate in this process.
        return send({ message: `隔离验证未注册：${method} ${path}；未访问实际业务。` }, method === 'GET' ? 404 : 405);
      } catch (error) { return send({ message: `隔离夹具请求失败：${error.message}` }, 400); }
    });
  },
};
const server = await createServer({
  root: project, configFile: `${project}/vite.config.ts`, envDir: preview, envPrefix: 'UI_PREVIEW_UNUSED_',
  plugins: [plugin], cacheDir: `${preview}/.vite-cache`,
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(''), 'import.meta.env.VITE_RECRUITMENT_API_BASE': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 4185, strictPort: true, fs: { allow: [project, preview] } },
});
await server.listen();
console.log('S02 memory-only preview: http://127.0.0.1:4185/__qa/s02-transfer-guard');
