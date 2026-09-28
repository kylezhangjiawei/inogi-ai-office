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
const markdown = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
const body = renderToStaticMarkup(React.createElement(Markdown, {
  remarkPlugins: [gfm],
  urlTransform: url => url.startsWith('E:/workCoding/inogi-ai-office/')
    ? path.relative(dir, url).replaceAll('\\', '/') : url,
}, markdown));
const gallery = [
  ['management-desktop', '管理总览', '区分目标、完成与实际净发货，指标保留范围与单位。'],
  ['procurement-detail-desktop', '采购任务详情', '四个业务栏目，下一步与责任人始终明确。'],
  ['sample-workspace-desktop', '样品协同', '资料与验证优先，登记和历史分别查阅。'],
  ['production-inspection-desktop', '检验详情', '初检、复验与原异常分别展示，保留原办理链。'],
  ['key-materials-desktop', '关键物料目录', '前置检索与筛选，表内滚动，分页固定可见。'],
  ['warehouse-record-desktop', '仓库记录详情', '交接数量与 ERP 核对分区，不混淆合格、不良和待判。'],
];
const cards = gallery.map(([file, title, note]) => `<figure><a href="screenshots/${file}.png" target="_blank" rel="noopener"><img loading="lazy" src="screenshots/${file}.png" alt="${title}实际页面截图"></a><figcaption><h3>${title}</h3><p>${note}</p></figcaption></figure>`).join('');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V1.1 第一轮优化 · 实施与验收</title><style>
:root{color-scheme:light;--ink:#1b2559;--muted:#64708c;--line:#e8edf5;--accent:#422afb}*{box-sizing:border-box}body{margin:0;background:#f6f8fc;color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}a{color:var(--accent);text-underline-offset:3px}header,main{width:min(1200px,calc(100% - 48px));margin:auto}header{padding:48px 0 24px}header .label{font-size:12px;letter-spacing:.1em;color:var(--muted)}header h1{font-size:32px;line-height:1.3;letter-spacing:-.03em;margin:10px 0}header p{max-width:790px;color:var(--muted)}nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}nav a{display:inline-block;padding:8px 14px;background:white;border:1px solid var(--line);border-radius:9px;text-decoration:none;font-weight:600}nav a:first-child{background:var(--accent);color:white;border-color:var(--accent)}.evidence{display:flex;flex-wrap:wrap;gap:8px 24px;padding:15px 0;margin-bottom:24px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}.evidence strong{color:var(--ink)}h2{font-size:22px;margin:32px 0 16px}h3{font-size:16px;margin:0 0 4px}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:24px}.gallery figure{margin:0;background:white;border:1px solid var(--line);border-radius:14px;overflow:hidden}.gallery img{display:block;width:100%;aspect-ratio:1.5;object-fit:contain;background:#f7f9fc}.gallery figcaption{padding:18px;border-top:1px solid var(--line)}.gallery p{margin:0;color:var(--muted);font-size:13px}.article{background:white;border:1px solid var(--line);border-radius:16px;padding:32px;margin:32px 0 48px;overflow:auto}.article h1{font-size:25px}.article h2{padding-top:16px;border-top:1px solid var(--line)}.article li{margin:8px 0}.article table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.7}.article th{background:#f5f7fc;text-align:left}.article td,.article th{padding:14px;border:1px solid var(--line);vertical-align:top}.article td:first-child{min-width:170px}.article td:nth-child(2){width:40%}.article p{overflow-wrap:anywhere}.foot{color:var(--muted);font-size:12px;margin:12px 0 32px}@media(max-width:760px){header,main{width:calc(100% - 28px)}header{padding-top:28px}header h1{font-size:26px}.gallery{grid-template-columns:1fr}.article{padding:18px}.article table{min-width:780px}}@media print{nav{display:none}body{background:white}.article{border:0;padding:0}.gallery{display:none}}
</style></head><body><header><div class="label">INOGI AI · V1.1 · 2026.09.20</div><h1>更清楚的总览，更专注的办理</h1><p>第一轮改造已落入当前系统：重点页面拆分列表与详情，减少长页堆叠，同时修正共享采购覆盖和人员筛选统计。保留原审核，逐项记录完成范围。</p><nav><a href="http://localhost:5173/">打开当前系统</a><a href="#screens">查看实际页面</a><a href="#status">查看 18 项状态</a><a href="../report.html">原完整审核报告</a></nav></header><main><div class="evidence"><span><strong>614</strong> 项前端回归通过</span><span><strong>16</strong> 项后端回归通过</span><span>前端 / API 类型检查通过</span><span>正式构建通过</span><span>1440 × 960 / 390 × 844 实看</span></div><section id="screens"><h2>本轮实际页面</h2><p class="foot">以下为本地系统原始截图；演示记录沿用现有数据。点击图片查看完整尺寸。</p><div class="gallery">${cards}</div></section><article id="status" class="article">${body}</article><p class="foot">本轮为重点页面与高风险口径的首轮实施；不表示完整审核中的所有业务缺口已经关闭。未部署，未向数据库或 ERP 提交业务记录。</p></main></body></html>`;
await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8');
console.log('Created implementation/index.html');
