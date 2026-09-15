import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createLinkedOrder as createOrder, createReadiness, createPlans, createDateCheck } from './fixtures.mjs';
import { workspaceTasks, arrivalDates, user, products } from './workspace-fixtures.mjs';
const project = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const preview = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${project}/package.json`);
const { createServer } = await import(require.resolve('vite'));
let order = createOrder();
let plans = createPlans(order).map((p,i)=>({...p,productId:'prod-portable-o2',createdBy:i===2?'someone-else':user.id,createdByName:i===2?'另一位采购员':user.name,targetDate:i===0?'2026-08-20':p.targetDate,tasks:i===0?[{...p.tasks[0],id:'qa-s08-dates'}]:p.tasks}));
function createPeopleTasks(order) {
 const source=workspaceTasks(order), template=source[0];
 return [...source,
 {...template,id:'qa-history-done',code:'CG-QA-DONE',status:'completed',materialName:'本月已完成历史阀体',needDate:'2026-09-05',purchaseOrders:[]},
 {...template,id:'qa-former-done',code:'CG-QA-FORMER',status:'completed',materialName:'移出名录人员历史任务',buyerUserId:'qa-former',buyer:'王采购（已移出名录）',needDate:'2026-09-05',purchaseOrders:[]},
 {...template,id:'qa-name-only',code:'CG-QA-LEGACY',materialName:'同名待核对历史任务',buyerUserId:null,buyer:user.name,needDate:'2026-08-10',purchaseOrders:[]}];
}
let tasks=createPeopleTasks(order);
let nextAction = '';
let historyError = false;
let plansError = false;
let tasksError = false;
let failNextRead = false;
const readJson = async (req) => { let text = ''; for await (const chunk of req) text += chunk; return text ? JSON.parse(text) : {}; };
const labels = { 'lines-error':'下一次物料订单读取失败', 'source-conflict': '下一次保存将模拟来源变更：本行到货日变为 9 月 18 日，返回 409。', 'version-conflict': '下一次保存将模拟他人先确认，返回 409；重载后可查看最新记录。', error: '下一次保存返回 503；草稿应保留，再次保存可成功。', 'conflict-reload-error': '下一次保存返回来源冲突；首次重新载入失败，再次重载可成功。', slow: '下一次保存延迟 3 秒，可检查按钮防重与关闭保护。' };
const plugin = {
  name: 'proc-finishing-memory-only', enforce: 'pre',
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
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws://127.0.0.1:4182 ws://localhost:4182; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
      const url = new URL(req.url || '/', 'http://127.0.0.1:4182');
      const path = url.pathname;
      const method = req.method || 'GET';
      const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Inogi-Fixture': 'S07-S08-memory-only' }); res.end(JSON.stringify(data)); };
      try {
        if (path === '/__qa/s07-s08') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>人员任务与到货日历 · 隔离验证</title></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@fs${preview}/preview.tsx"></script></body></html>`);
          return;
        }
        if (path === '/__qa/health') return send({ ok: true, fixture: 'S07-S08', apiMode: 'memory-only', nextAction, lines: order.items.map(({ id, availability }) => ({ id, availability })) });
        if (path === '/__qa/fail' && method === 'POST') { const input=await readJson(req); if ('history' in input) historyError=!!input.history; if ('plans' in input) plansError=!!input.plans; if ('tasks' in input) tasksError=!!input.tasks; return send({historyError,plansError,tasksError}); }
        if (path === '/__qa/config' && method === 'POST') { const input = await readJson(req); nextAction = Object.hasOwn(labels, input.next) ? input.next : ''; return send({ message: labels[nextAction] || '正常保存', nextAction }); }
        if (path === '/__qa/reset' && method === 'POST') { order = createOrder(); plans = createPlans(order); tasks=createPeopleTasks(order); nextAction = ''; failNextRead = false; return send({ ok: true }); }
        if (!path.startsWith('/api/')) return next();
        if (method !== 'GET') return send({message:'本轮隔离验证只覆盖读取，不模拟业务写入。'},501);
        if(path==='/api/audit/logs') {
          if(historyError) return send({message:'隔离验证：日期确认记录读取失败'},503);
          const lineId=url.searchParams.get('resourceId');
          const line=order.items.find(l=>l.id===lineId);
          const dateValues=[null,'2026-09-15','2026-09-17',null,'2026-09-18','2026-09-19','2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26'];
          const mode=req.headers['x-preview-access']||'manager';
          let entries=!line || line.lineNo==='1'?[]:Array.from({length:12},(_,i)=>({id:'qa-history-'+lineId+'-'+i,timestamp:`2026-09-${String(1+i).padStart(2,'0')}T02:30:00Z`,module:'procurement',source:'web',action:'purchase-order.availability-confirmed',actor:{id:i%2===0?user.id:'another-user',name:i%2===0?user.name:'另一位经办人（隔离验证）'},resource:{type:'proc-purchase-order-availability',id:lineId,name:order.poNo+' · '+line.lineNo},changes:[{field:'availableDate',before:dateValues[i],after:dateValues[i+1]},{field:'note',before:i?'上次确认说明':null,after:i===2?'撤销旧日期，等待供应商重新确认':'第 '+(i+1)+' 次核对说明（隔离验证）'},{field:'version',before:i,after:i+1}],metadata:{}})).reverse();
          if(mode==='own'||mode==='rd') entries=entries.filter(e=>e.actor.id===user.id);
          const pageSize=Number(url.searchParams.get('pageSize')||10); const total=entries.length; const page=Math.min(Math.max(1,Number(url.searchParams.get('page')||1)),Math.max(1,Math.ceil(total/pageSize)));
          return send({total,page,pageSize,snapshotAt:url.searchParams.get('snapshotAt')||new Date().toISOString(),canViewAll:mode!=='own',filterSignature:'fixture-'+lineId,stats:null,items:entries.slice((page-1)*pageSize,page*pageSize)});
        }
        if(path==='/api/auth/me') return send({user});
        if(path==='/api/research-development/products')return send(products);
        if(path==='/api/departments/directory')return send([]);
        if(path==='/api/procurement/buyer-roster')return send({members:[{...user,canReceiveTasks:true},{id:'qa-s01-other-buyer',name:user.name,canReceiveTasks:true}]});
        if(/^\/api\/procurement\/tasks\/[^/]+\/quotations$/.test(path))return send([]);
        if(path==='/api/procurement/buyers')return send([{...user,canReceiveTasks:true}]);
        if(path==='/api/procurement/sample-testers')return send([]);
        if(path==='/api/procurement/materials')return send({items:[],total:0,page:1,pageSize:10000});
        if(path==='/api/procurement/quotations') {
          if(url.searchParams.has('taskId'))return send([]);
          const rows=[{id:'qa-quote-a',materialId:'qa-material-a',supplierId:'qa-supplier-a',supplierName:'精密阀体供应商',unitPrice:30,currency:'CNY',leadTimeDays:5,quoteDate:'2026-09-01',isSelected:false},{id:'qa-quote-a2',materialId:'qa-material-a',supplierId:'qa-supplier-a2',supplierName:'标准阀体供应商',unitPrice:32,currency:'CNY',leadTimeDays:7,quoteDate:'2026-09-10',isSelected:true},{id:'qa-quote-b',materialId:'qa-material-b',supplierId:'qa-supplier-b',supplierName:'同名另一规格供应商',unitPrice:1,currency:'CNY',leadTimeDays:2,quoteDate:'2026-09-09',isSelected:false}];
          return send(rows.filter(row=>!url.searchParams.has('materialId')||row.materialId===url.searchParams.get('materialId')));
        }
        if(path==='/api/procurement/tasks' && tasksError) return send({message:'隔离验证：采购任务读取失败'},503);
        if(path==='/api/procurement/tasks')return send({items:tasks,total:tasks.length,page:1,pageSize:200});
        if(path==='/api/procurement/workspace-arrival-dates'){
          if(nextAction==='lines-error'){nextAction='';return send({message:'隔离演示：订单日期读取失败，请重试。'},503)}
          return send(arrivalDates(url.searchParams.getAll('refId'),tasks,order));
        }
        const taskMatch=path.match(/^\/api\/procurement\/tasks\/([^/]+)$/);
        if(taskMatch){const task=tasks.find(t=>t.id===decodeURIComponent(taskMatch[1]));return task?send(task):send({message:'演示任务不存在'},404)}
        if (path === '/api/procurement/stock-plans' && method === 'GET' && plansError) return send({message:'隔离验证：备货计划读取失败'},503);
        if (path === '/api/procurement/stock-plans' && method === 'GET') return send({items:plans.filter(p=>!url.searchParams.get('treeNodeId')||p.treeNodeId===url.searchParams.get('treeNodeId'))});
        if (/^\/api\/procurement\/stock-plans\/[^/]+\/readiness$/.test(path)) return send(createReadiness('Q5',300));
        const checkMatch=path.match(/^\/api\/procurement\/stock-plans\/([^/]+)\/order-date-check$/);
        if (checkMatch && method==='GET') {
          if(nextAction==='lines-error'){nextAction='';return send({message:'隔离验证：日期核对读取失败，请重试。'},503);}
          const plan=plans.find(p=>p.id===decodeURIComponent(checkMatch[1]));
          if(!plan)return send({message:'备货计划不存在'},404);
          return send(createDateCheck(plan,order,Number(url.searchParams.get('page')||1)));
        }
        if(path==='/api/rd/products') return send({items:[]});

        if (path === '/api/procurement/inventory-readiness' && method === 'GET') return send(createReadiness(url.searchParams.get('productLine') || 'Q5', Number(url.searchParams.get('targetSets') || 300)));
        if (path === '/api/procurement/tplus/views/purchase-order-lines' && method === 'GET') {
          if (nextAction === 'lines-error') { nextAction = ''; return send({message:'隔离验证：订单记录暂时无法读取，请重试。'},503); }
          const inventoryCode = url.searchParams.get('inventoryCode');
          const items = order.items.filter(line => line.sku === inventoryCode).map(line => ({
            id:line.id,orderNo:order.poNo,lineNo:line.lineNo,inventoryCode:line.sku,inventoryName:line.name,spec:line.spec,unit:line.unit,
            orderedQty:line.qty,receivedQty:line.receivedQty,etaDate:line.etaDate,orderDate:order.orderDate,supplierName:order.supplier,
            approvalStatus:order.approvalStatus,status:'已审批',syncedAt:order.syncedAt,availability:line.availability,
          }));
          const pageSize = 10; const totalPages=Math.max(1,Math.ceil(items.length/pageSize)); const page=Math.min(totalPages,Math.max(1,Number(url.searchParams.get('page')||1)));
          return send({source:'tplus',readOnly:true,inventoryCode,lines:{items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize,totalPages}});
        }

        if (path === '/api/procurement/tplus/views/purchase-orders/QA-PO-20260910' && method === 'GET') {
          if (failNextRead) { failNextRead = false; return send({ statusCode: 503, message: '隔离验证：重新载入失败，请再次重试。' }, 503); }
          return send({ order });
        }
        // Every unknown API path terminates locally; there is deliberately no backend proxy.
        return send({ statusCode: 404, message: `隔离验证未模拟：${method} ${path}；未访问实际业务数据。` }, 404);
      } catch (error) { return send({ statusCode: 400, message: `隔离验证请求失败：${error.message}` }, 400); }
    });
  },
};
const server = await createServer({
  root: project, configFile: `${project}/vite.config.ts`, envDir: preview, envPrefix: 'UI_PREVIEW_UNUSED_', plugins: [plugin], cacheDir: `${preview}/.vite-cache`,
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(''), 'import.meta.env.VITE_RECRUITMENT_API_BASE': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 4182, strictPort: true, fs: { allow: [project, preview] } },
});
await server.listen();
console.log('Procurement finishing preview: http://127.0.0.1:4182/__qa/s07-s08');
