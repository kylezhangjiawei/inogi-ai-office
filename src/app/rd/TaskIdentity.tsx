import { useEffect, useState } from "react";
import { cn } from "../components/ui/utils";
import { formatTraceDateTime } from "../RDProgressEvidence";
import { useAvatarDirectory } from "../lib/userAvatar";
import { t, useI18n } from "../lib/i18n";
import { displayPersonName, type Task } from './taskModel';

export function hashColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-pink-500", "bg-cyan-500", "bg-indigo-500", "bg-rose-500", "bg-teal-500",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

export function OwnerAvatar({
  name,
  size = "sm",
  userId,
}: {
  name: string;
  size?: "sm" | "xs";
  userId?: string | null;
}) {
  useI18n(); // 占位名（待指派）经 t() 显示，须订阅语言切换
  const resolveAvatar = useAvatarDirectory();
  const avatarUrl = resolveAvatar(name, userId);
  const [imgFailed, setImgFailed] = useState(false);
  // 头像 URL 变化（目录加载完成 / 失效重取）时重置失败态，允许新 URL 重新尝试
  useEffect(() => { setImgFailed(false); }, [avatarUrl]);

  // 系统占位名（待指派等）走字典翻译后再显示/取首字，英文态头像显示 "U" 而非 "待"
  const displayName = displayPersonName(name);
  const initial = displayName.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  const dim = size === "xs" ? "h-5 w-5" : "h-6 w-6";
  const textSize = size === "xs" ? "text-[10px]" : "text-xs";

  // 有真实头像 → 渲染图片；无头像或加载失败 → 回退文字首字母（原行为）
  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        title={displayName}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={cn("inline-block shrink-0 rounded-full object-cover ring-2 ring-white", dim)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white",
        dim,
        textSize,
        hashColor(name),
      )}
      title={displayName}
    >
      {initial}
    </span>
  );
}

/**
 * 子任务身份徽标：一眼区分「这不是独立任务」，并区分来源。
 * - created：在父任务下直建
 * - attached：由已有独立任务并入
 * - 缺省（存量子任务无 subtask_origin）：只显示中性「子」，不猜来源
 */
export function SubtaskBadge({ task, className }: {
  // 只取子任务身份三字段（结构型），使任务树 Task 与个人工作台 RdWorkspaceTask 都能直接传入
  task: Pick<Task, "subtask_origin" | "subtask_attached_by" | "subtask_attached_at">;
  className?: string;
}) {
  useI18n();
  const origin = task.subtask_origin;
  const cfg =
    origin === "attached"
      ? { label: t("并入"), cls: "bg-amber-50 text-amber-700 ring-amber-200" }
      : origin === "created"
        ? { label: t("子建"), cls: "bg-sky-50 text-sky-700 ring-sky-200" }
        : { label: t("子"), cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  const title =
    origin === "attached"
      ? [
          t("由已有任务并入为子任务"),
          task.subtask_attached_by ? t("操作人：{name}", { name: task.subtask_attached_by }) : "",
          task.subtask_attached_at ? t("时间：{time}", { time: formatTraceDateTime(task.subtask_attached_at) }) : "",
        ].filter(Boolean).join("\n")
      : origin === "created"
        ? t("在父任务下直接创建的子任务")
        : t("子任务");
  return (
    <span
      title={title}
      className={cn(
        "shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-tight ring-1 ring-inset",
        cfg.cls,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}
