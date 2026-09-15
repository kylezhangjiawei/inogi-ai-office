import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const project = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const preview = dirname(fileURLToPath(import.meta.url));
const plugin = { name: 'isolated-fulfillment', enforce: 'pre', configResolved(config) { config.server.proxy = undefined; },
  resolveId(source, importer) { if (!importer || !source.startsWith('.')) return null; const path = resolve(dirname(importer.split('?')[0]), source).replace(/\.[jt]sx?$/, ''); return [project + '/src/app/lib/purchaseFulfillmentApi', project + '/src/app/lib/procurementApi', project + '/src/app/auth'].includes(path) ? preview + '/api.ts' : null; },
  configureServer(server) { server.middlewares.use((req, res, next) => {
    if (req.url.startsWith('/api/')) { res.writeHead(405, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Isolated preview: API requests blocked' })); return; }
    if (req.url.split('?')[0] !== '/__qa/s14') return next(); res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>S14 isolated preview</title></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@fs${preview}/preview.tsx"></script></body></html>`);
  }); } };
const server = await createServer({ root: project, configFile: project + '/vite.config.ts', envDir: preview, envPrefix: 'QA_UNUSED_', cacheDir: preview + '/.vite-cache', plugins: [plugin], server: { host: '127.0.0.1', port: 4187, strictPort: true, hmr: false, watch: { ignored: ['**/*'] }, fs: { allow: [project] } } });
await server.listen(); console.log('http://127.0.0.1:4187/__qa/s14');
