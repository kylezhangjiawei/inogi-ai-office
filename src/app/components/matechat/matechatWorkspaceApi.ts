import { authFetch } from "../../lib/authSession";
import type { MateChatPageContext } from "./pageContext";

export type ResolvedPageContext = {
  schemaVersion: 1;
  status: "resolved" | "unavailable";
  ref?: MateChatPageContext;
  entity?: { id: string; title: string; workspace: "rd"; canonicalUrl: string; fields?: Record<string, unknown> };
  resolvedAt: string;
  shareBlocked: boolean;
};

export type DeliveryRequirement = { id?: string; title: string; keywords: string[]; required?: boolean };
export type DeliveryFile = { id: string; name: string; folder: string; size: number; mime: string; source: string; createdAt?: string; uploader?: string };
export type DeliveryRow = {
  id: string; title: string; keywords: string[]; required: boolean;
  status: "candidate" | "missing" | "confirmed" | "not_required";
  candidates: DeliveryFile[]; candidateCount: number; evidenceFileIds: string[]; confirmedAt: string | null;
  notice?: string;
};
export type DeliveryCheck = {
  id: string; conversationId: string; taskId: string; taskTitle: string; workspace: "rd";
  revision: number; checkedAt: string; createdAt: string; updatedAt: string;
  scopeNote: string; templateLabel: string; warnings: string[]; rows: DeliveryRow[];
  summary: { total: number; required: number; confirmed: number; candidate: number; missing: number; notRequired: number; unresolvedRequired: number };
};

export class WorkspaceRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function workspaceRequest<T>(path: string, options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await authFetch(`/api/chat/${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    signal: options.signal,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WorkspaceRequestError(Array.isArray(payload.message) ? payload.message.join("；") : payload.message || "暂时无法完成，请重试", response.status);
  return payload as T;
}

export const resolvePageContext = (pageContext: MateChatPageContext, signal?: AbortSignal) =>
  workspaceRequest<ResolvedPageContext>("page-context/resolve", { body: { pageContext }, signal });

/** 生成可核查的补充任务草稿；真实建任务仍使用已有动作确认卡。 */
export function deliveryTaskDraft(check: DeliveryCheck, row: DeliveryRow): string {
  return `请为研发任务 ${check.taskId}（${check.taskTitle}）准备一项补充资料任务：补充「${row.title}」。关联原研发任务，并说明资料用途。先查询原任务的分类和负责人，沿用该分类，负责人和截止日期由我确认；不要推测。先生成待确认动作卡，确认前不要创建。资料检查编号：${check.id}；本项目前未找到匹配资料，不代表其他位置一定没有。`;
}
