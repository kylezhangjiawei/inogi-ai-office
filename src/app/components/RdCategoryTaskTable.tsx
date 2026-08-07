import React, { useMemo } from "react";
import { AlertTriangle, CalendarClock, ChevronRight, GitBranch, UserRound } from "lucide-react";

import { AutoTranslatedText } from "./TranslatableText";
import { cn } from "./ui/utils";
import { t } from "../lib/i18n";
import type { RdWorkspaceTask } from "../lib/rdApi";
import { isTaskOverdue } from "../lib/taskDue";
import { workspaceTaskPreview } from "../lib/workspaceTaskPreview";

export type RdCategoryTaskTableSection = {
  key: string;
  label?: string;
  subtitle?: string;
  tasks: RdWorkspaceTask[];
};

type Props = {
  caption: string;
  sections: RdCategoryTaskTableSection[];
  onOpenTask?: (task: RdWorkspaceTask) => void;
  renderActions?: (task: RdWorkspaceTask) => React.ReactNode;
  emptyText?: string;
};

const REVIEW_TYPE_LABELS: Record<string, string> = {
  collaboration: "协作审批",
  result: "完成审批",
  proposal: "立项审批",
  due_date: "延期审批",
  abandon: "放弃审批",
};

function approvalLabel(task: RdWorkspaceTask): string {
  if (task.pending_review_type) {
    return REVIEW_TYPE_LABELS[task.pending_review_type] ?? task.pending_review_type;
  }
  return task.status === "completed" ? "已完成" : "无待审";
}

function orderTasksByHierarchy(tasks: RdWorkspaceTask[]): RdWorkspaceTask[] {
  if (tasks.length < 2) return tasks;
  const taskById = new Map(tasks.map((task) => [task.task_id, task] as const));
  const childrenByParent = new Map<string, RdWorkspaceTask[]>();
  const roots: RdWorkspaceTask[] = [];
  for (const task of tasks) {
    if (task.parent_task_id && taskById.has(task.parent_task_id)) {
      const children = childrenByParent.get(task.parent_task_id) ?? [];
      children.push(task);
      childrenByParent.set(task.parent_task_id, children);
    } else {
      roots.push(task);
    }
  }
  const ordered: RdWorkspaceTask[] = [];
  const visited = new Set<string>();
  const visit = (task: RdWorkspaceTask) => {
    if (visited.has(task.task_id)) return;
    visited.add(task.task_id);
    ordered.push(task);
    for (const child of childrenByParent.get(task.task_id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  // 防御脏数据中的父子环：表格仍应展示每一行，而不是静默丢失。
  for (const task of tasks) visit(task);
  return ordered;
}

function TaskRow({
  task,
  onOpenTask,
  renderActions,
}: {
  task: RdWorkspaceTask;
  onOpenTask?: (task: RdWorkspaceTask) => void;
  renderActions?: (task: RdWorkspaceTask) => React.ReactNode;
}) {
  const depth = Math.max(0, Math.min(4, (task.tree_depth ?? 1) - 1));
  const overdue = task.status !== "completed" && isTaskOverdue(task);
  const preview = workspaceTaskPreview(task);
  const score = task.completion_score;

  return (
    <tr className="group border-b border-slate-100 align-middle transition-colors hover:bg-indigo-50/35 [content-visibility:auto] [contain-intrinsic-size:58px]">
      <td className="min-w-[300px] px-4 py-3">
        <div className="flex min-w-0 items-start gap-2" style={{ paddingInlineStart: `${depth * 18}px` }}>
          <span className={cn(
            "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
            depth > 0 ? "bg-indigo-50 text-indigo-500" : "bg-slate-100 text-slate-500",
          )} aria-hidden="true">
            {depth > 0 ? <GitBranch className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onOpenTask?.(task)}
              disabled={!onOpenTask}
              className="block max-w-full truncate text-left text-[13px] font-semibold text-slate-900 decoration-indigo-300 underline-offset-2 enabled:hover:text-indigo-700 enabled:hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              title={task.title}
            >
              <AutoTranslatedText text={task.title} />
            </button>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400">
              <span className="font-mono">{task.task_id}</span>
              {task.parent_title && (
                <span className="max-w-[230px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-slate-500" title={task.parent_title}>
                  {t("上级：{title}", { title: task.parent_title })}
                </span>
              )}
              {task.sub_project_label && <span className="truncate">{task.sub_project_label}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="min-w-[130px] px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{task.role === "primary" ? task.owner || t("待指派") : `${t("协作")} · ${task.owner}`}</span>
        </div>
      </td>
      <td className="min-w-[130px] px-3 py-3">
        <div className="text-xs font-semibold text-slate-700">{t(task.status_label)}</div>
        <div className={cn("mt-0.5 text-[10px]", task.pending_review_type ? "font-semibold text-amber-600" : "text-slate-400")}>
          {t(approvalLabel(task))}
        </div>
      </td>
      <td className="min-w-[116px] px-3 py-3 text-xs">
        {task.due_date ? (
          <span className={cn("inline-flex items-center gap-1", overdue ? "font-semibold text-red-600" : "text-slate-600")}>
            {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
            {!overdue && <CalendarClock className="h-3.5 w-3.5 text-slate-400" />}
            {task.due_date}
          </span>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="min-w-[120px] px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full", task.progress >= 100 ? "bg-emerald-500" : "bg-indigo-500")}
              style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-slate-600">{task.progress}%</span>
        </div>
      </td>
      <td className="min-w-[100px] px-3 py-3">
        {score ? (
          <div className="text-xs font-semibold tabular-nums text-indigo-700">
            {score.total}<span className="ml-1 text-[10px] font-medium text-slate-400">{score.grade}</span>
          </div>
        ) : <span className="text-xs text-slate-300">—</span>}
      </td>
      <td className="min-w-[240px] max-w-[340px] px-3 py-3">
        {preview ? (
          <div className="line-clamp-2 text-[11px] leading-4 text-slate-600">
            <span className="mr-1 text-slate-400">{t(preview.label)}</span>
            <AutoTranslatedText text={preview.text} />
          </div>
        ) : <span className="text-xs text-slate-300">{t("暂无进展")}</span>}
      </td>
      {(renderActions || onOpenTask) && (
        <td className="sticky right-0 min-w-[108px] bg-white/95 px-3 py-3 text-right shadow-[-8px_0_16px_-16px_rgba(15,23,42,0.5)] transition-colors group-hover:bg-[#f7f8ff]">
          {renderActions ? renderActions(task) : (
            <button
              type="button"
              onClick={() => onOpenTask?.(task)}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              {t("查看")}<ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

export function RdCategoryTaskTable({ caption, sections, onOpenTask, renderActions, emptyText }: Props) {
  const orderedSections = useMemo(
    () => sections.map((section) => ({ ...section, tasks: orderTasksByHierarchy(section.tasks) })),
    [sections],
  );
  const total = orderedSections.reduce((sum, section) => sum + section.tasks.length, 0);

  if (total === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 text-sm text-slate-400">
        {emptyText ?? t("该类目下没有匹配的任务")}
      </div>
    );
  }

  const actionColumn = Boolean(renderActions || onOpenTask);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.05)]">
      <div className="max-w-full overflow-x-auto" tabIndex={0} aria-label={t("可横向滚动的类目任务表") }>
        <table className="w-full min-w-[1180px] table-auto border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-20 bg-slate-50/95 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 backdrop-blur">
            <tr className="border-b border-slate-200">
              <th scope="col" className="px-4 py-3">{t("任务")}</th>
              <th scope="col" className="px-3 py-3">{t("主责人")}</th>
              <th scope="col" className="px-3 py-3">{t("状态 / 审批")}</th>
              <th scope="col" className="px-3 py-3">{t("截止日期")}</th>
              <th scope="col" className="px-3 py-3">{t("进度")}</th>
              <th scope="col" className="px-3 py-3">{t("完成评分")}</th>
              <th scope="col" className="px-3 py-3">{t("最近进展")}</th>
              {actionColumn && <th scope="col" className="sticky right-0 bg-slate-50 px-3 py-3 text-right">{t("操作")}</th>}
            </tr>
          </thead>
          {orderedSections.map((section) => (
            <tbody key={section.key}>
              {section.label && (
                <tr className="border-y border-indigo-100 bg-indigo-50/65">
                  <th colSpan={actionColumn ? 8 : 7} scope="rowgroup" className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-900">{section.label}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums text-indigo-600 ring-1 ring-indigo-100">
                        {section.tasks.length} {t("项")}
                      </span>
                      {section.subtitle && <span className="text-[10px] font-normal text-slate-500">{section.subtitle}</span>}
                    </div>
                  </th>
                </tr>
              )}
              {section.tasks.map((task) => (
                <TaskRow key={task.task_id} task={task} onOpenTask={onOpenTask} renderActions={renderActions} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
