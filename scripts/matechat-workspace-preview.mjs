// 本机独立 UI 验收：全部资料与写入均为内存合成数据；不加载业务配置、身份或外部服务。
// node scripts/matechat-workspace-preview.mjs       http://127.0.0.1:5177
// node scripts/matechat-workspace-preview.mjs --self-test
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const PORT = 5177;
const now = () => new Date().toISOString();
const clone = (value) => structuredClone(value);
const taskId = 'RD-PREVIEW-001';
const taskTitle = '便携式环境监测仪 · 研发结项';
const conversationId = 'workspace-preview';
const requirements = [
  { id: 'requirements', title: '需求与规格说明', keywords: ['需求', '规格'], required: true },
  { id: 'design', title: '设计方案与图纸', keywords: ['设计', '图纸'], required: true },
  { id: 'bom', title: '物料清单（BOM）', keywords: ['BOM', '物料清单'], required: true },
  { id: 'testing', title: '测试与验证报告', keywords: ['测试', '验证'], required: true },
  { id: 'manual', title: '使用说明与交接资料', keywords: ['说明书', '交接'], required: true },
  { id: 'acceptance', title: '验收与结项记录', keywords: ['验收', '结项'], required: true },
];
const files = [
  ['spec-v2', '需求与规格说明_v2_已评审.pdf', '主任务/需求评审'],
  ['drawing-v3', '结构设计图纸_v3_用于样机试制.pdf', '结构研发/设计输出'],
  ['drawing-v2', '结构设计图纸_v2_旧版参考.pdf', '结构研发/设计输出'],
  ['test-v1', '可靠性测试与环境验证报告_待质量部门确认_2026-09.pdf', '测试验证/第三轮样机'],
  ['accept-v1', '验收与结项记录_内部评审.pdf', '结项评审'],
].map(([id, name, folder], index) => ({ id, name, folder: `研发/监测仪/${folder}`, size: 128000 + index * 16384, mime: 'application/pdf', source: 'task', createdAt: '2026-09-08T01:00:00.000Z', uploader: '合成验收用户' }));

function matchingFiles(requirement) {
  return files.filter((file) => requirement.keywords.some((keyword) => file.name.toLowerCase().includes(keyword.toLowerCase())));
}

function makeRow(requirement, previous) {
  const candidates = matchingFiles(requirement);
  const unchanged = previous && previous.title === requirement.title && previous.required === requirement.required && JSON.stringify(previous.keywords) === JSON.stringify(requirement.keywords);
  const retained = unchanged && ['confirmed', 'not_required'].includes(previous.status);
  return {
    ...requirement,
    status: retained ? previous.status : candidates.length ? 'candidate' : 'missing',
    candidates: clone(candidates), candidateCount: candidates.length,
    evidenceFileIds: retained && previous.status === 'confirmed' ? previous.evidenceFileIds : [],
    confirmedAt: retained && previous.status === 'confirmed' ? previous.confirmedAt : null,
  };
}

function updateSummary(check) {
  const { rows } = check;
  check.summary = {
    total: rows.length, required: rows.filter((row) => row.required).length,
    confirmed: rows.filter((row) => row.status === 'confirmed').length,
    candidate: rows.filter((row) => row.status === 'candidate').length,
    missing: rows.filter((row) => row.status === 'missing').length,
    notRequired: rows.filter((row) => row.status === 'not_required').length,
    unresolvedRequired: rows.filter((row) => row.required && !['confirmed', 'not_required'].includes(row.status)).length,
  };
  return check;
}

function makeCheck(sequence = 1, mixed = false) {
  const time = now();
  const rows = requirements.map((requirement) => makeRow(requirement));
  if (mixed) {
    rows[0].status = 'confirmed'; rows[0].evidenceFileIds = ['spec-v2']; rows[0].confirmedAt = time;
    rows[4].status = 'not_required';
  }
  return updateSummary({
    id: `check-preview-${sequence}`, conversationId, taskId, taskTitle, workspace: 'rd', revision: 1,
    checkedAt: time, createdAt: time, updatedAt: time,
    templateLabel: '研发结项参考清单（可编辑，非公司正式交付标准）',
    scopeNote: '仅检查当前任务及子任务中你有权查看的附件，并按文件名及元数据寻找候选；未检索正文，不判断内容合规或是否为最新版本。未匹配不代表其他位置不存在资料。',
    warnings: [], scannedFileCount: files.length, rows,
  });
}

export function createFixture(scenario = 'ready') {
  return {
    scenario, checks: scenario === 'empty' ? [] : [makeCheck(1, true)], sequence: 1, archives: [], events: [],
    nextFailure: scenario === 'conflict' ? 'conflict' : scenario === 'failure' ? 'failure' : '',
    invalidateOnRefresh: scenario === 'changed',
  };
}

export function fixtureRequest(state, path, method = 'GET', body = {}) {
  const fail = (message, status) => ({ status, data: { message } });
  const ok = (data) => ({ status: 200, data: clone(data) });
  state.events.push({ path, method, body: clone(body), at: now() });
  if (path === 'page-context/resolve') {
    if (state.scenario === 'context-error') return fail('合成场景：读取超时', 503);
    if (state.scenario === 'unavailable') return ok({ schemaVersion: 1, status: 'unavailable', resolvedAt: now(), shareBlocked: true });
    return ok({ schemaVersion: 1, status: 'resolved', ref: body.pageContext, entity: { id: taskId, title: taskTitle, workspace: 'rd', canonicalUrl: `/rd-task/${taskId}`, fields: { status: 'in_progress', progress: 85 } }, resolvedAt: now(), shareBlocked: true });
  }
  if (path === '__preview/state') return ok(state);
  if (path === 'delivery-checks' && method === 'GET') return ok(state.checks);
  if (path === 'delivery-checks' && method === 'POST') {
    if (!body.taskId?.trim()) return fail('请填写任务编号', 400);
    const check = makeCheck(++state.sequence); check.taskId = body.taskId.trim();
    state.checks.unshift(check); return ok(check);
  }
  const [, id, action, fileId, subAction] = path.split('/');
  if (!path.startsWith('delivery-checks/')) return fail('独立验收环境：没有真实业务接口', 404);
  const check = state.checks.find((item) => item.id === id);
  if (!check) return fail('资料检查不存在', 404);
  if (state.nextFailure) {
    const failure = state.nextFailure; state.nextFailure = '';
    return failure === 'conflict' ? fail('清单或证据已发生变化，请刷新清单后重新核对', 409) : fail('资料来源暂时读取失败，本次没有生成检查结论，请稍后刷新', 503);
  }
  if (body.revision !== check.revision) return fail('清单或证据已发生变化，请刷新清单后重新核对', 409);
  if (action === 'files' && subAction === 'preview') {
    const file = check.rows.flatMap((row) => row.candidates).find((item) => item.id === fileId);
    if (!file) return fail('资料不在当前检查范围内', 404);
    return ok({ url: `/__synthetic-original/${encodeURIComponent(fileId)}`, name: file.name, mime: file.mime, expiresIn: 60, isTaskPage: false });
  }
  if (method === 'PATCH') {
    if (body.requirements) {
      if (!Array.isArray(body.requirements) || !body.requirements.length || body.requirements.length > 20) return fail('清单需包含 1–20 项', 400);
      check.rows = body.requirements.map((row, index) => makeRow({ ...row, id: row.id || `added-${index}-${check.revision}`, required: row.required !== false }, check.rows.find((previous) => previous.id === row.id)));
    } else {
      for (const update of body.updates ?? []) {
        const row = check.rows.find((item) => item.id === update.id);
        if (!row) return fail('清单项目不存在', 400);
        if (update.status === 'confirmed') {
          if (!update.evidenceFileIds?.length || update.evidenceFileIds.some((fileId) => !row.candidates.some((file) => file.id === fileId))) return fail('请选择当前清单中的证据资料', 400);
          row.status = 'confirmed'; row.evidenceFileIds = clone(update.evidenceFileIds); row.confirmedAt = now();
        } else {
          row.status = update.status === 'not_required' ? 'not_required' : row.candidates.length ? 'candidate' : 'missing';
          row.evidenceFileIds = []; row.confirmedAt = null;
        }
      }
    }
  } else if (action === 'refresh') {
    if (state.invalidateOnRefresh) {
      for (const row of check.rows) if (row.status === 'confirmed') {
        row.status = row.candidates.length ? 'candidate' : 'missing'; row.evidenceFileIds = []; row.confirmedAt = null;
        row.notice = '原确认文件已变化、移出范围或不可访问，请重新核对。';
        row.candidates = row.candidates.map((file) => ({ ...file, name: file.name.replace('_v2_', '_v3_') }));
      }
      state.invalidateOnRefresh = false;
    }
  } else if (action === 'archive') {
    if (!check.rows.some((row) => row.status === 'confirmed')) return fail('请先核对并确认至少一项资料', 400);
    const archive = { id: `archive-preview-${state.archives.length + 1}`, status: 'queued', filename: `${body.filename || '结项资料'}.zip` };
    state.archives.unshift(archive); check.revision += 1; check.updatedAt = now();
    return ok({ check: updateSummary(check), archive });
  } else return fail('验收场景未定义此操作', 404);
  check.revision += 1; check.checkedAt = now(); check.updatedAt = now();
  return ok(updateSummary(check));
}

const main = `import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MateChatContextCard} from '/src/app/components/matechat/MateChatContextCard.tsx';
import {MateChatDeliveryChecks} from '/src/app/components/matechat/MateChatDeliveryChecks.tsx';
import {createRdTaskPageContext} from '/src/app/components/matechat/pageContext.ts';
import {useConversationDraft} from '/src/app/components/matechat/useConversationDraft.ts';
import '/src/styles/index.css';
window.__matechatPreviewSession = crypto.randomUUID();
const scenarios = [['ready','混合状态'],['empty','空白并新建'],['conflict','下次操作版本冲突'],['failure','下次操作来源失败'],['changed','刷新后撤回确认'],['unavailable','关联任务不可用'],['context-error','关联读取失败']];
function DraftHarness(){
 const [conversation, setConversation] = useState(null);
 const [running, setRunning] = useState(false);
 const [results, setResults] = useState([]);
 const state = useConversationDraft('synthetic-preview-user', conversation);
 const live = useRef(state);
 useEffect(()=>{live.current=state;},[state]);
 const run = async()=>{
  setRunning(true);setResults([]);
  const tick=()=>new Promise((resolve)=>setTimeout(resolve,40));
  const assert=(condition,name)=>{if(!condition)throw new Error(name);setResults((current)=>[...current,'通过：'+name]);};
  const suffix=Date.now();const A='A-'+suffix,B='B-'+suffix,C='C-'+suffix;
  try {
   setConversation(null);await tick();
   live.current.setDraft('首次会话草稿');live.current.setAttachments([{id:'initial-file',name:'首次附件.pdf'}]);live.current.setPageContext(createRdTaskPageContext('RD-INITIAL'));await tick();
   setConversation(A);await tick();
   assert(live.current.draft==='首次会话草稿'&&live.current.attachments[0]?.id==='initial-file'&&live.current.pageContext?.refs[0].entityId==='RD-INITIAL','首次关联、附件与草稿转移到首个会话');
   live.current.setDraft('A 的草稿');live.current.setAttachments([{id:'file-A',name:'A 附件.pdf'}]);live.current.setPageContext(createRdTaskPageContext('RD-A'));await tick();
   const capturedUploadSetter=live.current.setAttachments;
   setConversation(B);await tick();
   assert(live.current.draft===''&&live.current.attachments.length===0&&live.current.pageContext===undefined,'B 会话初始为空，不继承 A 的草稿');
   capturedUploadSetter((previous)=>[...previous,{id:'late-A',name:'A 延迟上传.pdf'}]);await tick();
   assert(live.current.attachments.length===0,'切换后完成的 A 上传没有进入 B');
   live.current.setDraft('B 的草稿');live.current.setAttachments([{id:'file-B',name:'B 附件.pdf'}]);await tick();
   setConversation(A);await tick();
   assert(live.current.draft==='A 的草稿'&&live.current.attachments.map((file)=>file.id).join(',')==='file-A,late-A'&&live.current.pageContext?.refs[0].entityId==='RD-A','返回 A 保留原草稿、关联和延迟完成附件');
   live.current.setPageContext(null);await tick();setConversation(B);await tick();
   assert(live.current.draft==='B 的草稿'&&live.current.attachments[0]?.id==='file-B','返回 B 保留其独立草稿与附件');
   setConversation(A);await tick();assert(live.current.pageContext===null,'移除关联后再切换回来仍保持 null');
   setConversation(C);await tick();assert(live.current.draft===''&&live.current.attachments.length===0&&live.current.pageContext===undefined,'新会话 C 不再接收首次待定草稿');
  }catch(error){setResults((current)=>[...current,'失败：'+error.message]);}finally{setRunning(false);}
 };
 return <section aria-label="会话草稿隔离验证" className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-800">会话草稿隔离验证</h2><button type="button" disabled={running} onClick={run} className="min-h-9 rounded-lg bg-[#002fa7] px-3 text-xs text-white disabled:opacity-50">{running?'正在运行草稿检查…':'运行草稿隔离检查'}</button></div><p className="mt-2 text-xs leading-5 text-slate-500">运行真实 useConversationDraft：初次转移、A/B 切换、延迟上传、移除关联和新会话均使用合成数据。</p><ol aria-live="polite" className="mt-3 space-y-2 text-xs text-slate-700">{results.map((result,index)=><li key={index}>{result}</li>)}</ol><p className="mt-3 text-xs text-slate-400">当前：{conversation||'尚未创建会话'} · 附件 {state.attachments.length} · 关联 {state.pageContext===null?'已移除':state.pageContext?.refs[0].entityId||'无'}</p></section>;
}
function Preview(){
 const [context, setContext] = useState(()=>createRdTaskPageContext('${taskId}'));
 const [launchKey, setLaunchKey] = useState(0);
 const [draft, setDraft] = useState('');
 const [events, setEvents] = useState([]);
 const scenario = new URLSearchParams(location.search).get('scenario') || 'ready';
 const record=(text)=>setEvents((current)=>[text,...current]);
 const ask=(text)=>{setDraft(text);record('已填写草稿，尚未发送');};
 return <main className="horizon-theme mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
   <header><p className="text-xs font-medium text-[#002fa7]">独立验收环境 · 全部为合成资料</p><h1 className="mt-2 text-2xl font-bold text-slate-900">MateChat 任务与结项资料</h1><p className="mt-2 text-sm leading-6 text-slate-500">使用真实界面组件，验证关联任务、资料核对和后续草稿。请关闭检查窗口后切换场景；每次刷新都会重置合成数据。</p></header>
   <section className="rounded-xl border border-slate-200 bg-white p-4"><label className="block text-xs font-medium text-slate-600">验收场景<select aria-label="验收场景" value={scenario} onChange={(event)=>location.assign('/?scenario='+event.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">{scenarios.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><p className="mt-2 text-xs text-slate-500">桌面及手机尺寸均可操作。文件原件以本机合成页面展示。</p></section>
   <section className="rounded-2xl border border-[#e9edf7] bg-white p-4 sm:p-5"><h2 className="mb-4 text-sm font-semibold text-slate-900">当前会话</h2>
   {context ? <MateChatContextCard context={context} active={true} disabled={false} onRemove={()=>{setContext(null);record('已移除任务关联');}} onCheck={()=>setLaunchKey((n)=>n+1)} onAsk={ask}/> : <button className="min-h-9 text-sm text-[#002fa7]" onClick={()=>setContext(createRdTaskPageContext('${taskId}'))}>重新关联任务</button>}
   <MateChatDeliveryChecks conversationId="${conversationId}" active={true} taskId="${taskId}" launchKey={launchKey} refreshKey={0} onDraftTask={(text,id)=>{ask(text);record('补充任务草稿关联 '+id);}} onArchive={()=>record('资料包回调已触发：仅合成后台队列')}/>
   <label className="mt-4 block text-xs text-slate-500">消息草稿（不会自动发送）<textarea aria-label="消息草稿" value={draft} onChange={(event)=>setDraft(event.target.value)} placeholder="点击分析下一步，或从未找到的资料准备补充任务" className="mt-2 min-h-32 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 text-slate-700"/></label>
   </section><section aria-label="验收回调记录" className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h2 className="text-xs font-semibold text-slate-700">验收回调记录</h2>{events.length ? <ol className="mt-2 space-y-2 text-xs text-slate-600">{events.map((event,index)=><li key={index}>{event}</li>)}</ol> : <p className="mt-2 text-xs text-slate-400">等待界面操作</p>}</section><DraftHarness/>
 </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Preview/></React.StrictMode>);`;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MateChat 工作区独立验收</title></head><body><div id="root"></div><script type="module" src="/__workspace_preview.tsx"></script></body></html>';

async function startPreview() {
  const sessions = new Map();
  const server = await createServer({
    root, configFile: false, envDir: '/private/tmp', envPrefix: 'WORKSPACE_PREVIEW_UNUSED_',
    plugins: [{
      name: 'workspace-synthetic-preview', enforce: 'pre',
      resolveId(id) {
        if (id === '/__workspace_preview.tsx') return id;
        if (id.endsWith('/authSession')) return '\0workspace-preview-auth';
      },
      load(id) {
        if (id === '/__workspace_preview.tsx') return main;
        if (id === '\0workspace-preview-auth') return `export const authFetch = (path, options = {}) => fetch(path, { ...options, credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Preview-Session': window.__matechatPreviewSession, 'X-Preview-Scenario': new URLSearchParams(location.search).get('scenario') || 'ready' } });`;
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
          const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
          try {
            if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/', html)); return; }
            if (url.pathname.startsWith('/__synthetic-original/')) {
              const file = files.find((item) => item.id === decodeURIComponent(url.pathname.split('/').at(-1)));
              res.writeHead(file ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
              res.end(`<html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成资料原件</title><body style="font:16px system-ui;max-width:720px;margin:40px auto;padding:20px;color:#1b2559"><p>本机合成资料预览</p><h1>${file?.name || '资料不存在'}</h1><p>这是一份用于验证查看原件流程的合成资料，不含真实业务信息。</p><p>文件编号：${file?.id || '未知'}</p></body></html>`); return;
            }
            if (!url.pathname.startsWith('/api/')) return next();
            if (!url.pathname.startsWith('/api/chat/')) return send({ message: '独立验收环境：没有真实业务接口' }, 404);
            let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 100000) return send({ message: '请求过大' }, 413); }
            const body = JSON.parse(raw || '{}');
            const session = String(req.headers['x-preview-session'] || 'default');
            if (!sessions.has(session)) sessions.set(session, createFixture(String(req.headers['x-preview-scenario'] || 'ready')));
            const result = fixtureRequest(sessions.get(session), url.pathname.replace('/api/chat/', ''), req.method, body);
            return send(result.data, result.status);
          } catch (error) { return send({ message: error.message }, 500); }
        });
      },
    }, react(), tailwindcss()],
    define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(''), 'import.meta.env.VITE_RECRUITMENT_API_BASE': JSON.stringify('') },
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  });
  await server.listen(); server.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
}

function selfTest() {
  const state = createFixture('empty');
  assert.deepEqual(fixtureRequest(state, 'delivery-checks').data, []);
  let check = fixtureRequest(state, 'delivery-checks', 'POST', { conversationId, taskId }).data;
  assert.equal(check.summary.confirmed, 0);
  assert.equal(check.summary.missing, 2);
  check = fixtureRequest(state, `delivery-checks/${check.id}`, 'PATCH', { revision: check.revision, updates: [{ id: 'design', status: 'confirmed', evidenceFileIds: ['drawing-v3'] }] }).data;
  assert.equal(check.summary.confirmed, 1);
  const preview = fixtureRequest(state, `delivery-checks/${check.id}/files/drawing-v3/preview`, 'POST', { revision: check.revision });
  assert.equal(preview.data.url, '/__synthetic-original/drawing-v3');
  const archived = fixtureRequest(state, `delivery-checks/${check.id}/archive`, 'POST', { revision: check.revision });
  assert.equal(archived.data.archive.status, 'queued');
  check = archived.data.check;
  state.invalidateOnRefresh = true;
  check = fixtureRequest(state, `delivery-checks/${check.id}/refresh`, 'POST', { revision: check.revision }).data;
  assert.equal(check.summary.confirmed, 0);
  assert.equal(fixtureRequest(state, `delivery-checks/${check.id}/archive`, 'POST', { revision: check.revision }).status, 400);
  assert.equal(fixtureRequest(state, `delivery-checks/${check.id}/refresh`, 'POST', { revision: 1 }).status, 409);
  check = fixtureRequest(state, `delivery-checks/${check.id}`, 'PATCH', { revision: check.revision, requirements: [{ title: '安装验证记录', keywords: ['安装'], required: false }] }).data;
  assert.equal(check.rows.length, 1); assert.equal(check.rows[0].status, 'missing'); assert.equal(check.rows[0].required, false);
  for (const [scenario, status] of [['conflict', 409], ['failure', 503]]) {
    const failing = createFixture(scenario);
    assert.equal(fixtureRequest(failing, 'delivery-checks/check-preview-1/refresh', 'POST', { revision: 1 }).status, status);
    assert.equal(fixtureRequest(failing, 'delivery-checks/check-preview-1/refresh', 'POST', { revision: 1 }).status, 200);
  }
  assert.equal(fixtureRequest(createFixture('unavailable'), 'page-context/resolve', 'POST').data.status, 'unavailable');
  assert.equal(fixtureRequest(createFixture('context-error'), 'page-context/resolve', 'POST').status, 503);
  console.log('Preview fixtures verified: creation, evidence selection, originals, archive, refresh invalidation, editing, conflict/failure recovery, context fallback.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else await startPreview();
}
