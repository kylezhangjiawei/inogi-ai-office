import type { RdWorkspaceTask } from "./rdApi";

type WorkspaceTaskPreviewSource = Pick<RdWorkspaceTask, "latest_progress_summary" | "next_action">;

export type WorkspaceTaskPreview = {
  label: "最新进展：" | "下一步：";
  text: string;
  source: "latest_progress" | "next_action";
};

/**
 * 项目任务树的摘要文案需要区分真实的最新进展与兜底行动建议。
 * 不能把成员刚提交的评论式进展统一标成“下一步”，否则用户会误以为评论丢失。
 */
export function workspaceTaskPreview(task: WorkspaceTaskPreviewSource): WorkspaceTaskPreview | null {
  const latestProgress = task.latest_progress_summary?.text?.trim();
  if (latestProgress) {
    return { label: "最新进展：", text: latestProgress, source: "latest_progress" };
  }

  const nextAction = task.next_action?.trim();
  if (nextAction) {
    return { label: "下一步：", text: nextAction, source: "next_action" };
  }

  return null;
}
