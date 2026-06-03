// 研发任务「完成质量评估报告」生成器（单份 + 批量）。
//
// 为什么用「打印窗口」而不是 jsPDF / html2canvas：
//  · 项目用 Tailwind v4，默认色为 oklch()，html2canvas 解析不了 oklch 会直接报错；
//  · 纯 jsPDF 不内置中文字体，需要嵌入数 MB 的 TTF，得不偿失；
//  · 浏览器原生打印能完美渲染中文、产出可选中文字的矢量 PDF，且零依赖。
// 因此这里生成内联样式（不含 Tailwind/oklch）的自包含 HTML，在新窗口里唤起打印，
// 用户在打印对话框中选择「另存为 PDF」即可下载正式报告。批量导出时把多份拼成一份多页文档。
import type { RdTask, RdTaskCompletionScore, RdTaskProgressNote } from "./rdApi";

const PRIORITY_LABEL: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  in_progress: "进行中",
  pending_review: "待审核",
  paused_leave: "暂停·请假",
  paused_blocked: "暂停·阻塞",
  on_hold: "暂停·挂起",
  completed: "已完成",
  pending_assign: "待指派",
};

// 等级配色（纯 hex，避免 oklch）。
const GRADE_COLOR: Record<string, { fg: string; bg: string; border: string }> = {
  A: { fg: "#047857", bg: "#ecfdf5", border: "#a7f3d0" },
  B: { fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  C: { fg: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  D: { fg: "#be123c", bg: "#fff1f2", border: "#fecdd5" },
};

function gradeColor(grade: string) {
  return GRADE_COLOR[grade] ?? GRADE_COLOR.C;
}

/** HTML 转义，防止任务标题/评语里的尖括号破坏标记或注入。 */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// 等级相关样式以内联 style 注入（批量文档里每个任务等级不同，不能用全局 CSS 写死颜色）。
const REPORT_STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans CN", "Noto Sans CJK SC", sans-serif;
    color: #0f172a; background: #f1f5f9; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 10px; justify-content: flex-end; padding: 12px 16px; background: #1e293b; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
  .toolbar button { border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .toolbar .primary { background: #4f46e5; color: #fff; }
  .toolbar .ghost { background: #475569; color: #e2e8f0; }
  .page { display: block; max-width: 820px; margin: 24px auto; background: #fff; padding: 40px 44px; box-shadow: 0 10px 30px rgba(15,23,42,.08); border-radius: 6px; }
  .report-head { border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 22px; }
  .report-head h1 { margin: 0; font-size: 22px; letter-spacing: 1px; }
  .report-head .sub { margin-top: 6px; color: #64748b; font-size: 12px; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
  .meta th, .meta td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; vertical-align: top; }
  .meta th { background: #f8fafc; color: #475569; font-weight: 600; width: 80px; white-space: nowrap; }
  .score-hero { display: flex; align-items: center; gap: 22px; padding: 18px 22px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 10px; margin-bottom: 8px; }
  .score-hero .total { font-size: 46px; font-weight: 800; line-height: 1; white-space: nowrap; }
  .score-hero .total span { font-size: 16px; color: #94a3b8; font-weight: 600; }
  .score-hero .grade { font-size: 20px; font-weight: 800; border: 1.5px solid #fde68a; border-radius: 8px; padding: 6px 14px; background: #fff; white-space: nowrap; }
  .score-hero .summary { flex: 1; font-size: 13px; line-height: 1.7; color: #334155; }
  h2.section { font-size: 15px; margin: 26px 0 12px; padding-left: 10px; border-left: 4px solid #4f46e5; }
  table.dims { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.dims th, table.dims td { border: 1px solid #e2e8f0; padding: 8px 10px; vertical-align: middle; }
  table.dims th { background: #f8fafc; color: #475569; font-weight: 600; }
  .dim-name { width: 92px; font-weight: 600; color: #1e293b; }
  .dim-score { width: 72px; white-space: nowrap; color: #475569; }
  .dim-score strong { color: #0f172a; font-size: 14px; }
  .dim-bar { width: 130px; }
  .bar-track { height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; background: #b45309; }
  .dim-comment { color: #475569; line-height: 1.6; }
  .grid2 { display: flex; gap: 18px; }
  .grid2 > div { flex: 1; }
  .list { margin: 6px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.8; }
  .list.good li { color: #047857; }
  .list.warn li { color: #b45309; }
  .muted { color: #94a3b8; font-size: 13px; margin: 6px 0 0; }
  .tl { margin: 6px 0 0; }
  .tl-item { padding: 6px 0 8px 14px; border-left: 2px solid #e2e8f0; position: relative; }
  .tl-item:last-child { padding-bottom: 0; }
  .tl-item::before { content: ''; position: absolute; left: -5px; top: 8px; width: 8px; height: 8px; border-radius: 50%; background: #6366f1; }
  .tl-meta { font-size: 11px; color: #94a3b8; }
  .tl-text { font-size: 12.5px; color: #334155; line-height: 1.6; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
  .foot { margin-top: 30px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; line-height: 1.9; }
  .foot .mono { font-family: ui-monospace, Menlo, Consolas, monospace; color: #64748b; }
  .cover-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
  .cover-stats .stat { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 14px; font-size: 13px; color: #475569; background: #f8fafc; }
  .cover-stats .stat strong { font-size: 18px; color: #0f172a; margin-right: 4px; }
  table.manifest td.n { width: 28px; color: #94a3b8; text-align: center; }
  table.manifest .g { font-weight: 800; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 0; border-radius: 0; }
    .break-page { break-before: page; -webkit-column-break-before: always; page-break-before: always; }
    @page { size: A4; margin: 14mm 12mm; }
    table.dims tr, .score-hero, .grid2, .tl-item { break-inside: avoid; page-break-inside: avoid; }
  }
`;

/** 单个任务的报告主体（不含外层 .page 容器；由 wrapDoc 包裹）。含进度留痕时间线。 */
function renderReportBody(task: RdTask, score: RdTaskCompletionScore, notes: RdTaskProgressNote[]): string {
  const gc = gradeColor(score.grade);
  const useAi = !score.fallback_reason;
  const collaborators =
    (task.collaborators ?? [])
      .map((c) => c.name)
      .filter(Boolean)
      .map((name) => esc(name))
      .join("、") || "—";

  const dimRows = score.dimensions
    .map((d) => {
      const pct = Math.max(0, Math.min(100, Math.round((d.score / d.max) * 100)));
      return `<tr>
        <td class="dim-name">${esc(d.label)}</td>
        <td class="dim-score"><strong>${esc(d.score)}</strong> / ${esc(d.max)}</td>
        <td class="dim-bar"><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${gc.fg}"></div></div></td>
        <td class="dim-comment">${esc(d.comment) || "—"}</td>
      </tr>`;
    })
    .join("");

  const highlights = score.highlights?.length
    ? `<ul class="list good">${score.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
    : `<p class="muted">无</p>`;
  const improvements = score.improvements?.length
    ? `<ul class="list warn">${score.improvements.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : `<p class="muted">无</p>`;

  const sortedNotes = [...(notes ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const timeline = sortedNotes.length
    ? `<div class="tl">${sortedNotes
        .map((n) => {
          const meta = [
            fmtDateTime(n.created_at),
            `${esc(n.actor?.name) || "—"}${n.actor?.role ? `（${esc(n.actor.role)}）` : ""}`,
            typeof n.progress === "number" ? `进度 ${esc(n.progress)}%` : "",
            n.attachments?.length ? `${n.attachments.length} 个附件` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return `<div class="tl-item"><div class="tl-meta">${meta}</div><div class="tl-text">${esc(n.text) || "—"}</div></div>`;
        })
        .join("")}</div>`
    : `<p class="muted">无进度留痕记录</p>`;

  return `
    <div class="report-head">
      <h1>研发任务完成质量评估报告</h1>
      <div class="sub">任务编号 ${esc(task.task_id)} · 报告导出于 ${fmtDateTime(new Date().toISOString())}</div>
    </div>

    <table class="meta">
      <tr><th>任务名称</th><td colspan="3">${esc(task.title)}</td></tr>
      <tr>
        <th>主责人</th><td>${esc(task.primary_owner) || "—"}</td>
        <th>协作人</th><td>${collaborators}</td>
      </tr>
      <tr>
        <th>所属分类</th><td>${esc(task.category_path) || "—"}</td>
        <th>优先级</th><td>${esc(PRIORITY_LABEL[task.final_priority] ?? task.final_priority)}</td>
      </tr>
      <tr>
        <th>截止日期</th><td>${fmtDay(task.due_date)}</td>
        <th>当前状态</th><td>${esc(STATUS_LABEL[task.status] ?? task.status)}</td>
      </tr>
    </table>

    <div class="score-hero" style="border-color:${gc.border};background:${gc.bg}">
      <div class="total" style="color:${gc.fg}">${esc(score.total)}<span> / 100</span></div>
      <div class="grade" style="color:${gc.fg};border-color:${gc.border}">${esc(score.grade)} · ${esc(score.grade_label)}</div>
      <div class="summary">${esc(score.summary) || "—"}</div>
    </div>

    <h2 class="section">分项评分</h2>
    <table class="dims">
      <thead><tr><th>维度</th><th>得分</th><th>水平</th><th>评语</th></tr></thead>
      <tbody>${dimRows}</tbody>
    </table>

    <h2 class="section">亮点与改进建议</h2>
    <div class="grid2">
      <div><strong style="font-size:13px;color:#047857;">✓ 亮点</strong>${highlights}</div>
      <div><strong style="font-size:13px;color:#b45309;">! 改进建议</strong>${improvements}</div>
    </div>

    <h2 class="section">进度留痕（${sortedNotes.length} 条）</h2>
    ${timeline}

    <div class="foot">
      <div>评分方式：${useAi ? `AI 复盘（模型 <span class="mono">${esc(score.provider)}/${esc(score.model)}</span>）` : `规则估算兜底（AI 不可用，原因：<span class="mono">${esc(score.fallback_reason ?? "未知")}</span>）`}</div>
      <div>评分生成时间：${fmtDateTime(score.computed_at)}</div>
      <div>评分基于「时效性 / 过程透明度 / 交付证据 / 协作与风险管理」4 维度，各满分 25 分。本报告由系统自动生成，评分仅供绩效参考。</div>
    </div>`;
}

/** 批量报告的封面页（范围概览 + 各任务清单表）。 */
function renderBatchCover(scopeLabel: string, items: BatchReportItem[]): string {
  const n = items.length;
  const avg = n > 0 ? Math.round(items.reduce((s, it) => s + it.score.total, 0) / n) : 0;
  const dist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of items) dist[it.score.grade] = (dist[it.score.grade] ?? 0) + 1;

  const rows = items
    .map((it, i) => {
      const gc = gradeColor(it.score.grade);
      return `<tr>
        <td class="n">${i + 1}</td>
        <td><span class="mono" style="font-size:11px;color:#64748b">${esc(it.task.task_id)}</span></td>
        <td>${esc(it.task.title)}</td>
        <td>${esc(it.task.primary_owner) || "—"}</td>
        <td style="text-align:right;font-weight:700">${esc(it.score.total)}</td>
        <td class="g" style="color:${gc.fg}">${esc(it.score.grade)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="report-head">
      <h1>研发任务完成质量评估报告（批量）</h1>
      <div class="sub">范围：${esc(scopeLabel)} · 共 ${n} 个已评分任务 · 导出于 ${fmtDateTime(new Date().toISOString())}</div>
    </div>
    <div class="cover-stats">
      <div class="stat"><strong>${avg}</strong>平均分</div>
      <div class="stat"><strong style="color:#047857">${dist.A}</strong>A 卓越</div>
      <div class="stat"><strong style="color:#1d4ed8">${dist.B}</strong>B 良好</div>
      <div class="stat"><strong style="color:#b45309">${dist.C}</strong>C 合格</div>
      <div class="stat"><strong style="color:#be123c">${dist.D}</strong>D 待改进</div>
    </div>
    <h2 class="section">任务清单</h2>
    <table class="dims manifest">
      <thead><tr><th class="n">#</th><th>任务编号</th><th>任务名称</th><th>主责人</th><th style="text-align:right">得分</th><th>等级</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">
      <div>本批量报告每个任务独占一页，后附逐任务的分项评分、亮点/改进建议与进度留痕。评分仅供绩效参考。</div>
    </div>`;
}

/** 把若干报告主体包成一份可打印文档：每个 section 独占一页，自动唤起打印对话框。 */
function wrapDoc(fileTitle: string, sections: string[]): string {
  const body = sections
    .map((s, i) => `<section class="page${i > 0 ? " break-page" : ""}">${s}</section>`)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(fileTitle)}</title>
<style>${REPORT_STYLES}</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">打印 / 另存为 PDF</button>
    <button class="ghost" onclick="window.close()">关闭</button>
  </div>
  ${body}
  <script>
    // 自动唤起打印对话框（用户可选择"另存为 PDF"下载）。延迟以确保字体/样式渲染完成。
    window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 400); });
  </script>
</body>
</html>`;
}

/** 单份报告 HTML。 */
export function buildTaskCompletionReportHtml(
  task: RdTask,
  score: RdTaskCompletionScore,
  notes: RdTaskProgressNote[] = [],
): string {
  return wrapDoc(`完成质量报告_${task.task_id}`, [renderReportBody(task, score, notes)]);
}

export type BatchReportItem = {
  task: RdTask;
  score: RdTaskCompletionScore;
  notes: RdTaskProgressNote[];
};

/** 批量报告 HTML（封面清单 + 逐任务分页）。 */
export function buildBatchCompletionReportHtml(scopeLabel: string, items: BatchReportItem[]): string {
  const sections = [renderBatchCover(scopeLabel, items), ...items.map((it) => renderReportBody(it.task, it.score, it.notes))];
  return wrapDoc(`完成质量报告_批量_${items.length}份`, sections);
}

function openPrintWindow(html: string): boolean {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

/**
 * 在新窗口生成并打开单份完成质量报告，自动唤起打印（→「另存为 PDF」）。
 * @returns false 表示窗口被浏览器弹窗拦截，调用方应提示用户放行。
 */
export function openTaskCompletionReport(
  task: RdTask,
  score: RdTaskCompletionScore,
  notes: RdTaskProgressNote[] = [],
): boolean {
  return openPrintWindow(buildTaskCompletionReportHtml(task, score, notes));
}

/** 在新窗口生成并打开批量完成质量报告。@returns false 表示被弹窗拦截。 */
export function openBatchCompletionReport(scopeLabel: string, items: BatchReportItem[]): boolean {
  return openPrintWindow(buildBatchCompletionReportHtml(scopeLabel, items));
}
