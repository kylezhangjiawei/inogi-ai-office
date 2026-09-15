import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { orders, receiptLedger, syncedAt, user } from './fixtures.mjs';

const project = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const preview = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${project}/package.json`);
const { createServer } = await import(require.resolve('vite'));
let orderError = false;
const requestLog = [];
const readJson = async (req) => { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('请求过大'); } return text ? JSON.parse(text) : {}; };
const plugin = {
  name: 's14-fulfillment-memory-only', enforce: 'pre',
  configResolved(config) { config.server.proxy = undefined; },
  resolveId(source, importer) {
    if (!importer || (!source.startsWith('.') && !source.startsWith('/'))) return null;
    const candidate = resolve(dirname(importer.split('?')[0]), source).replace(/\.[jt]sx?$/, '');
    if (candidate === `${project}/src/app/auth`) return `${preview}/auth-preview.tsx`;
    if (candidate === `${project}/src/app/lib/authSession`) return `${preview}/auth-session-preview.ts`;
    return null;
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws://127.0.0.1:4184 ws://localhost:4184; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
      const url = new URL(req.url || '/', 'http://127.0.0.1:4184');
      const path = url.pathname;
      const method = req.method || 'GET';
      const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Inogi-Fixture': 'S14-memory-only' }); res.end(JSON.stringify(data)); };
      try {
        if (path === '/__qa/s14-fulfillment' && method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>S14 订单履约 · 隔离验证</title></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@fs${preview}/preview.tsx"></script></body></html>`);
          return;
        }
        if (path === '/__qa/health' && method === 'GET') return send({ ok: true, fixture: 'S14', apiMode: 'memory-only', orderError, orders: Object.keys(orders), requests: requestLog });
        if (path === '/__qa/config' && method === 'POST') {
          const input = await readJson(req);
          if (typeof input.orderError !== 'boolean') return send({ message: '请提供 orderError 布尔值' }, 400);
          orderError = input.orderError;
          return send({ orderError });
        }
        if (!path.startsWith('/api/')) return next();
        requestLog.push({ method, path, at: new Date().toISOString(), authorization: Boolean(req.headers.authorization) });
        if (requestLog.length > 100) requestLog.shift();
        if (method !== 'GET') return send({ message: 'S14 隔离验证只允许业务读取，写请求已拒绝，未访问真实业务。' }, 405);
        if (path === '/api/auth/me') return send({ user });
        if (path === '/api/audit/logs') return send({ items: [], total: 0, page: 1, pageSize: Number(url.searchParams.get('pageSize') || 10), snapshotAt: url.searchParams.get('snapshotAt') || syncedAt, canViewAll: false, filterSignature: `qa-s14-${url.searchParams.get('resourceId') || 'none'}`, stats: null });
        const receiptMatch = path.match(/^\/api\/procurement\/purchase-order-lines\/([^/]+)\/receipts$/);
        if (receiptMatch) {
          const ledger = receiptLedger(decodeURIComponent(receiptMatch[1]));
          return ledger ? send(ledger) : send({ message: '隔离订单行不存在' }, 404);
        }
        const orderMatch = path.match(/^\/api\/procurement\/tplus\/views\/purchase-orders\/([^/]+)$/);
        if (orderMatch) {
          if (orderError) return send({ message: '隔离验证：采购订单读取失败，请恢复读取后重试。' }, 503);
          const order = orders[decodeURIComponent(orderMatch[1])];
          return order ? send({ order }) : send({ message: '隔离订单不存在' }, 404);
        }
        return send({ message: `隔离验证未模拟：${method} ${path}；未访问实际业务。` }, 404);
      } catch (error) { return send({ message: `隔离验证请求失败：${error.message}` }, 400); }
    });
  },
};
const server = await createServer({
  root: project, configFile: `${project}/vite.config.ts`, envDir: preview, envPrefix: 'UI_PREVIEW_UNUSED_',
  plugins: [plugin], cacheDir: `${preview}/.vite-cache`,
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(''), 'import.meta.env.VITE_RECRUITMENT_API_BASE': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 4184, strictPort: true, fs: { allow: [project, preview] } },
});
await server.listen();
console.log('S14 memory-only preview: http://127.0.0.1:4184/__qa/s14-fulfillment');
