import { toast } from "sonner";
import { AuditLog } from "../lib/auditLog";
import { type RdTaskProgressNote, blockedDaysOf } from "../lib/rdApi";
import { currentI18nLang, i18nLocale, t } from "../lib/i18n";
import { fetchContentTranslation } from "../components/TranslatableText";
import { type Task, STATUS_CONFIG, displayPersonName, PRIORITY_CONFIG } from './taskModel';

/** Blob → dataURL（生成问题时把留痕附件字节转 dataURL，喂给问题模块的 uploadAttachment）。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取附件失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 单任务过程报告导出（协同模块）：任务概要 + 工作项 + 完整留痕时间线（含附件清单）
 * 生成 Word 兼容 HTML 并下载为 .doc——跨团队交接/领导汇报直接可发。
 */
export async function downloadUsCollabTaskReport(
  task: Task,
  logs: AuditLog[],
  noteOf: (logId: string) => RdTaskProgressNote | undefined,
) {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isEn = currentI18nLang() === "en";
  // 英文态：动态中文内容（标题/描述/留痕/时间线动作）走翻译通道——详情页浏览过的内容已有
  // 服务端缓存基本秒回，未缓存的单条 10s 超时回退原文，不让导出卡死
  const tr = async (text: string | null | undefined): Promise<string> => {
    const raw = (text ?? "").trim();
    if (!raw || !isEn) return raw;
    // 30s 上限：超时计时含 4 并发队列排队时间，留痕多的报告排队较长（超时静默回退原文）
    return (await fetchContentTranslation(raw, 30_000)) ?? raw;
  };
  if (isEn) toast.info(t("正在生成报告，动态内容翻译中…"));

  const workItems = task.work_items ?? [];
  const doneCount = workItems.filter((it) => it.done).length;
  const locale = i18nLocale();
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? esc(iso) : `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  };
  const statusLabel = t(STATUS_CONFIG[task.status]?.label ?? task.status);
  const blockedDays = blockedDaysOf(task);

  // 并发预翻译（fetchContentTranslation 内部有缓存/去重/限流）
  const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const [trTitle, trDescription, trComments, trWorkItems] = await Promise.all([
    tr(task.title),
    tr(task.description),
    Promise.all(sortedLogs.map((log) => tr(log.comment ?? ""))),
    Promise.all(workItems.map((it) => tr(it.title))),
  ]);

  const timelineRows = sortedLogs
    .map((log, i) => {
      const note = noteOf(log.id);
      const attachments = note?.attachments?.length
        ? `<div style="color:#64748b;font-size:12px;">${t("附件：")}${note.attachments.map((a) => esc(a.name)).join("、")}</div>`
        : "";
      return `<tr>
        <td style="white-space:nowrap;vertical-align:top;color:#64748b;">${fmtTime(log.timestamp)}</td>
        <td style="white-space:nowrap;vertical-align:top;">${esc(displayPersonName(log.actor?.name ?? ""))}</td>
        <td>${esc(trComments[i])}${attachments}</td>
      </tr>`;
    })
    .join("");

  const workItemsBlock = workItems.length
    ? `<h2>${t("工作项")}（${doneCount}/${workItems.length}）</h2>
       <ul>${workItems.map((it, i) => `<li>${it.done ? "☑" : "☐"} ${esc(trWorkItems[i])}${it.owner_name ? `（${esc(it.owner_name)}）` : ""}</li>`).join("")}</ul>`
    : "";

  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(trTitle)}</title>
<style>body{font-family:"Microsoft YaHei",sans-serif;font-size:13px;color:#0f172a;line-height:1.7;}h1{font-size:20px;}h2{font-size:15px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-top:18px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left;}</style></head><body>
<h1>${esc(trTitle)}</h1>
<p style="color:#64748b;">${t("任务过程报告")} · ${t("生成于")} ${new Date().toLocaleString(locale)} · ${esc(task.task_id)}</p>
<h2>${t("任务概要")}</h2>
<table>
<tr><th>${t("状态")}</th><td>${esc(statusLabel)}${blockedDays != null ? `（${t("已阻塞 {n} 天", { n: blockedDays })}）` : ""}</td><th>${t("进度")}</th><td>${task.progress}%</td></tr>
<tr><th>${t("主责人")}</th><td>${esc(displayPersonName(task.primary_owner))}</td><th>${t("优先级")}</th><td>${esc(t(PRIORITY_CONFIG[task.final_priority]?.label ?? task.final_priority))}</td></tr>
<tr><th>${t("协作人")}</th><td>${esc((task.collaborators ?? []).map((c) => c.name).join("、") || "—")}</td><th>${t("截止日期")}</th><td>${esc(task.due_date || "—")}</td></tr>
</table>
${trDescription ? `<h2>${t("任务描述")}</h2><p>${esc(trDescription).replace(/\n/g, "<br/>")}</p>` : ""}
${workItemsBlock}
<h2>${t("过程时间线（{n} 条）", { n: logs.length })}</h2>
<table><tr><th style="width:130px;">${t("时间")}</th><th style="width:80px;">${t("操作人")}</th><th>${t("内容")}</th></tr>${timelineRows || `<tr><td colspan="3">${t("暂无记录")}</td></tr>`}</table>
</body></html>`;

  const blob = new Blob(["﻿", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const namePrefix = isEn ? "Task-Report" : "任务过程报告";
  a.download = `${namePrefix}-${trTitle.slice(0, 40).replace(/[\\/:*?"<>|]/g, "_")}-${new Date().toISOString().slice(0, 10)}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}
