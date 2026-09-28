import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { default: Markdown } = await import(pathToFileURL(require.resolve('react-markdown')).href);
const { default: gfm } = await import(pathToFileURL(require.resolve('remark-gfm')).href);
const sourceDir = 'C:/Users/Administrator/Documents/xwechat_files/zjw19920831_8887/msg/file/2026-09/INOGI_AI驾驶舱_V1.1全套开发资料_33页高保真/INOGI_AI驾驶舱_V1.1开发资料';
const pages = JSON.parse(await fs.readFile(path.join(sourceDir, 'page_map.json'), 'utf8'));
const matrix = JSON.parse(await fs.readFile(path.join(dir, 'page-matrix.json'), 'utf8'));
const comparisons = [
  ['G00', '02-g00-home', '当前首页承接个人办公聚合，原型要求公司交付与跨部门风险总览。并非只差顶部标题。'],
  ['S00', '01-s00-cockpit', '已保留采购任务及新名称；原型所需按批次的需求、齐套与质量风险尚未成为总览主体。'],
  ['S01', '13-s01-personal-workspace', '左表右详情、分页、到货安排和 MateChat 已有。主要缺口在采购决策字段，不要求恢复已取消的上方计划条和步骤条。'],
  ['S03', '12-s03-sample-workspace', '详情图位置与右侧样品列表已补齐；样例没有图片不算组件缺失。仍需把资料、验证类型与试验依据放进主要办理路径。'],
  ['P00', '10-p00-production-overview', '当前总览是目标与作业聚合，未覆盖原型的整机完成、首检、在岗和风险。'],
  ['P01', '06-p01-production-batches', '当前可新增批次和作业，但卡片堆叠没有形成按日、产线的排程和已开工调整入口。'],
  ['P10', '08-p10-transfer-ecn', '当前正式转产页已有发布与验证状态；资料使用文本引用，ECN 未提供受控文件对比和无法执行反馈。当前截图为该页首屏。'],
  ['S18', '14-s18-key-materials', '月度明细占据长页，全量目录检索靠后；缺来源产品上下文和完整原单下钻。'],
];
await fs.mkdir(path.join(dir,'prototypes'), {recursive:true});
for (const [id] of comparisons) await fs.copyFile(path.join(sourceDir,pages.find(p=>p.id===id).image),path.join(dir,'prototypes',`${id}.png`));

const steps = [
  ['01','S00 全部采购任务','/proc-cockpit','不清晰','任务视图可用；尚未形成交付总览。','01-s00-cockpit'],
  ['02','G00 系统首页','/','受阻','个人办公聚合不能回答公司交付风险。','02-g00-home'],
  ['03','R00 研发驾驶舱','/rd-task-management','可用但不完整','卡片、附件和进度已有；确认版本与关联业务不直观。','03-r00-rd-cockpit'],
  ['04','R01 现有任务→技术资料','/rd-task/:taskId','可用但不完整','技术资料页与历史能力存在；本记录资料为空，不计为缺功能。','04-r01-technical-files'],
  ['05','S04 库存齐套中心','/proc-inventory-readiness','不清晰','明确是未按到货日过滤的理论齐套；按期计算另在生产入口。','05-s04-theoretical-readiness'],
  ['06','P01 批次与派工','/production-execution','可用但不完整','正式批次、编制作业已有；缺既有作业调整和日程矩阵。','06-p01-production-batches'],
  ['07','P02 现场作业','/production-execution → 现场作业','可用但不完整','报工/检验/协同动作存在；现场不良及来源批次不足。','07-p02-shop-floor'],
  ['08','P05/P10 转产与 ECN','/production-execution → 转产与 ECN','不清晰','发布/独立验证已有；文本资料和原样品内部 ID 不利于追查。','08-p10-transfer-ecn'],
  ['09','S15 齐套与占用','/production-execution → 齐套与占用','可用但不完整','正式月度日期计算存在；当前数据不足诚实显示待核对；F01另由隔离复现确认。','09-s15-monthly-readiness'],
  ['10','P00/P06 生产总览与现场待办','/production-dashboard','受阻','能进入作业，未聚合质量/样品/ECN全类待办。','10-p00-production-overview'],
  ['11','S00 选零任务采购负责人','/proc-cockpit → 采购负责人','受阻','任务流0，但顶部仍12/6/3；F10实测复现。','11-s00-person-filter'],
  ['12','S03 样品协同','/proc-cockpit → 样品协同','可用但不完整','左右分栏、图片位置和实际时间已实现；验证依据较深，类型门槛不足。','12-s03-sample-workspace'],
  ['13','S01 全部进行中→选中采购任务','/proc-my-workspace','可用但不完整','表格分页、右详情、到货安排和原MateChat已实看；缺净采购判断。','13-s01-personal-workspace'],
  ['14','S18 关键物料','/proc-key-materials','不清晰','月度条目可读，检索目录在长列表后；原单导航和上下文需补齐。','14-s18-key-materials'],
];
await fs.writeFile(path.join(dir,'capture-manifest.json'),JSON.stringify(steps.map(([step,title,route,health,note,file])=>({step,title,route,health,note,screenshot:`screenshots/${file}.png`,source:'current-run localhost browser; original unedited capture'})),null,2)+'\n');
const safeCell = value => String(value).replace(/\|/g,'／').replace(/\n/g,' ');
const mdTable = (headers, rows) => [headers,headers.map(()=> '---'),...rows].map(row=>'| '+row.map(safeCell).join(' | ')+' |').join('\n');
let body = await fs.readFile(path.join(dir,'report-body.md'),'utf8');
body=body.replace('<!-- COMPARISONS -->', comparisons.map(([id,shot,note])=>`### ${id} · ${pages.find(p=>p.id===id).title}\n\n${note}\n\n| 需求原型 | 当前页面（2026-09-20 本地） |\n| --- | --- |\n| ![${id}需求原型](prototypes/${id}.png) | ![${id}当前页面](screenshots/${shot}.png) |\n`).join('\n'));
body=body.replace('<!-- MATRIX -->',mdTable(['原型视图','当前正式入口','已实现','偏差与边界','评价'],matrix.map(p=>[p.id+' '+p.title,p.currentEntry,p.implemented,p.gap,p.assessment])));
body=body.replace('<!-- STEPS -->',mdTable(['步骤','页面/操作','当前路由','健康状态','观察结论','截图'],steps.map(([id,title,route,health,note,file])=>[id,title,'`'+route+'`',health,note,`[查看${id}](screenshots/${file}.png)`])));
await fs.writeFile(path.join(dir,'report.md'),body);

const escape = x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = x=>String(x).trim().replace(/\s+/g,'-');
const urlTransform = url => {
 if(/^[A-Za-z]:[\\/]/.test(url)) return pathToFileURL(url.replace(/:\d+$/,'')).href;
 return url.endsWith('.md') ? url.slice(0,-3)+'.html' : url;
};
function renderMd(md){
 return renderToStaticMarkup(React.createElement(Markdown,{remarkPlugins:[gfm],urlTransform,components:{
  h2:({children})=>React.createElement('h2',{id:slug(children)},children),
  h3:({children})=>React.createElement('h3',{id:slug(children)},children),
  table:({children})=>React.createElement('div',{className:'table-scroll'},React.createElement('table',null,children)),
  img:({src,alt})=>React.createElement('a',{className:'image-link',href:src,target:'_blank',rel:'noopener'},React.createElement('img',{src,alt,loading:'lazy'})),
  a:({href,children})=>React.createElement('a',{href},children)
 }},md));
}
const css=`:root{color-scheme:light;--ink:#202b36;--muted:#657281;--line:#dce4e9;--accent:#096b72;--bg:#f2f5f6}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:var(--ink)}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}button,input{font:inherit}.side{position:fixed;left:0;top:0;width:252px;height:100dvh;background:#172f36;color:#e3eff0;padding:32px 22px;overflow:auto}.side .brand{font-size:20px;font-weight:700;letter-spacing:.04em}.side .sub{font-size:12px;color:#bed1d3;margin:5px 0 30px}.side a{display:block;color:#d2e2e4;padding:10px 8px;border-radius:6px;font-size:13px;line-height:1.5}.side a:hover{background:#25454d;text-decoration:none}.side .small{margin-top:30px;color:#9fb8bc;font-size:12px}.shell{margin-left:252px;max-width:1500px;padding:30px 38px 64px}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;margin-bottom:22px;color:var(--muted);font-size:13px}.toolbar button{border:1px solid var(--line);background:#fff;border-radius:7px;padding:7px 13px;cursor:pointer;color:var(--ink)}.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);background:#fff;border-radius:10px;margin-bottom:24px;overflow:hidden}.stats div{padding:17px 22px;border-right:1px solid var(--line)}.stats div:last-child{border:0}.stats b{display:block;font-size:26px;line-height:1.4;font-variant-numeric:tabular-nums}.stats span{color:var(--muted);font-size:12px}article{background:#fff;border:1px solid var(--line);border-radius:12px;padding:32px 38px;min-width:0}h1{font-size:32px;line-height:1.35;letter-spacing:-.025em;margin:0 0 12px}h2{font-size:23px;margin:50px 0 18px;padding-top:18px;border-top:2px solid #c8d8db;scroll-margin-top:25px;line-height:1.5}h2:first-of-type{margin-top:28px}h3{font-size:18px;line-height:1.6;margin:32px 0 12px;scroll-margin-top:25px}p{margin:12px 0 17px}strong{font-weight:650}li{margin:8px 0}ul,ol{padding-left:23px}code{font-size:12px;background:#eef3f5;padding:2px 5px;border-radius:3px;overflow-wrap:anywhere}pre{padding:18px;background:#edf3f5;overflow:auto}blockquote{margin:20px 0;border-left:3px solid var(--accent);padding:12px 20px;background:#f1f7f7}.table-scroll{overflow:auto;border:1px solid var(--line);border-radius:8px;margin:18px 0 24px}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.75}th,td{text-align:left;vertical-align:top;padding:13px 14px;border-bottom:1px solid var(--line);min-width:110px}th{background:#edf4f4;color:#304b50;font-weight:650}td{overflow-wrap:anywhere}tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#fafcfc}.image-link{display:block}img{display:block;width:100%;height:auto;max-height:410px;object-fit:contain;object-position:top;background:#f4f7f9;border:1px solid #e5ebef}td:has(.image-link){width:50%;padding:8px}.table-scroll:has(.image-link) table{table-layout:fixed}.filter{display:flex;gap:12px;align-items:center;margin:15px 0;color:var(--muted);font-size:13px}.filter input{padding:9px 12px;border:1px solid var(--line);border-radius:7px;width:min(100%,480px);background:#fff}footer{margin-top:25px;font-size:12px;color:var(--muted)}.appendix-link{display:inline-block;padding:7px 12px;border:1px solid var(--line);border-radius:6px;margin-bottom:18px}@media(min-width:1800px){.shell{margin-left:calc(252px + (100vw - 1800px)/3)}}@media(max-width:1050px){.side{width:205px;padding:24px 14px}.shell{margin-left:205px;padding:24px 20px}article{padding:24px}h1{font-size:28px}}@media(max-width:720px){.side{position:static;width:auto;height:auto;padding:18px}.side nav{display:none}.side .sub,.side .small{margin:5px 0}.shell{margin:0;padding:18px 12px}article{padding:20px 16px}.stats{grid-template-columns:repeat(2,1fr)}.stats div{border-bottom:1px solid var(--line)}h1{font-size:25px}th,td{min-width:150px}.table-scroll:has(.image-link) th,.table-scroll:has(.image-link) td{min-width:0}}@media print{body{background:#fff;font-size:10pt}.side,.toolbar,.filter{display:none}.shell{margin:0;padding:0;max-width:none}article{border:0;padding:0}.stats{page-break-inside:avoid}h2,h3{break-after:avoid}table{font-size:8pt}.table-scroll{overflow:visible}th,td{padding:7px;min-width:0}img{max-height:280px}a{color:inherit}a.image-link{break-inside:avoid}footer{margin-top:15px}}`;
function html(md,title,main=false){
 const headings=[...md.matchAll(/^## (.+)$/gm)].map(m=>m[1]);
 const nav=headings.map(h=>`<a href="#${escape(slug(h))}">${escape(h)}</a>`).join('');
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body><aside class="side"><div class="brand">INOGI AI</div><div class="sub">V1.1 对照审核 · 2026.09.20</div><nav>${nav}</nav><div class="small">需求对照 / 当前实现 / 证据<br>只读审核，未修改业务代码</div></aside><main class="shell"><div class="toolbar"><span>需求与实际实现的差距 · 本地工作区快照</span><div><a href="report.md">Markdown</a> &nbsp; <button onclick="window.print()">打印 / 保存 PDF</button></div></div>${main?'<div class="stats"><div><b>33</b><span>原型视图全量映射</span></div><div><b>14</b><span>当前页面与状态截图</span></div><div><b>18</b><span>归并后的主要偏差</span></div><div><b>1</b><span>已隔离复现的错算</span></div></div>':'<a class="appendix-link" href="report.html">← 返回主报告</a>'}<article>${renderMd(md)}</article><footer>证据范围：原始需求资料、正式实现源码、本轮本地页面和隔离测试。报告不代表线上发布验收。图片点击可查看原尺寸。</footer></main><script>for (const h of document.querySelectorAll('h2')) {if(h.textContent.includes('全部 33')) {const box=h.nextElementSibling?.nextElementSibling; if(box?.classList.contains('table-scroll')) {const label=document.createElement('label');label.className='filter';const input=document.createElement('input');input.type='search';input.placeholder='筛选页面编号、名称、入口或缺口';input.setAttribute('aria-label','筛选33页对照表');const count=document.createElement('span');count.textContent='33 / 33 个视图';label.append(input,count);box.before(label);input.addEventListener('input',()=>{let n=0;for(const row of box.querySelectorAll('tbody tr')){const ok=row.textContent.toLowerCase().includes(input.value.toLowerCase());row.hidden=!ok;if(ok)n++}count.textContent=n+' / 33 个视图'})}}}</script></body></html>`;
}
await fs.writeFile(path.join(dir,'report.html'),html(body,'INOGI AI V1.1 对照审核报告',true));
for(const name of ['overview-rd','supply-s00-s08','supply-s09-s18','production-p00-p10','docx-source-crosscheck']){
 const md=await fs.readFile(path.join(dir,`${name}.md`),'utf8');
 await fs.writeFile(path.join(dir,`${name}.html`),html(md,md.split('\n')[0].replace(/^# /,'')));
}
const audit={pages:matrix.length,captures:steps.length,comparisons:comparisons.length,findings:[...body.matchAll(/^### F\d+/gm)].length,priorities:{P1:[...body.matchAll(/^### F\d+ · P1/gm)].length,P2:[...body.matchAll(/^### F\d+ · P2/gm)].length},markdownChars:body.length};
await fs.writeFile(path.join(dir,'report-build-summary.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
