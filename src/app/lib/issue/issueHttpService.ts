/**
 * 问题记录与 AI 定位 — 真实后端 IssueService（HTTP 实现）。
 *
 * 与内存 mock（issueService.ts）实现同一 IssueService 契约，故上层组件零改即可切换。
 * 后端：apps/api/src/modules/issue/*。附件经 /api/files/upload 落 OSS/FileAsset，
 * Attachment.id 即 FileAsset.id（兼作 fileId），发送时回传给后端解析多模态/抽取文本。
 */
import { authFetch, readErrorMessage } from "../authSession";
import { uploadResourceFile } from "../resourceUpload";
import type {
  AiConfig,
  AiModelChoice,
  AnalysisVersion,
  Attachment,
  ChatUser,
  DimensionStat,
  Issue,
  IssueMessage,
  IssueQuery,
  IssueService,
  IssueStats,
  NewIssueInput,
  Paged,
  SendChatInput,
  SendChatResult,
  SimilarMatch,
  UploadFileInput,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await authFetch(`${API_BASE}${path}`, {
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `请求失败：${response.status}`));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function buildQuery(query: IssueQuery): string {
  const params = new URLSearchParams();
  const q = query || {};
  const entries: Array<[string, unknown]> = [
    ["statusGroup", q.statusGroup],
    ["severity", q.severity],
    ["source", q.source],
    ["product", q.product],
    ["dimension", q.dimension],
    ["specificCause", q.specificCause],
    ["search", q.search],
    ["page", q.page],
    ["pageSize", q.pageSize],
  ];
  for (const [k, v] of entries) {
    if (v !== undefined && v !== null && `${v}` !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** dataURL（base64）→ Blob，用于把粘贴/选择的文件以二进制上传。 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 轮询长耗时 AI 任务（analyze/adjust/chat 返回 taskId 后调用）。
 * 每次轮询是 <1s 短请求，绕开反代对单个长请求的超时；done 取结果、error 抛错。
 */
async function pollTask<T>(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const interval = opts.intervalMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60 * 1000);
  await delay(600);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const task = await request<{ status: "pending" | "done" | "error"; result?: T; error?: string }>(
      `/api/issues/tasks/${encodeURIComponent(taskId)}`,
    );
    if (task.status === "done") return task.result as T;
    if (task.status === "error") throw new Error(task.error || "AI 处理失败");
    if (Date.now() > deadline) throw new Error("AI 分析超时，请稍后重试");
    await delay(interval);
  }
}

/** 把前端 Attachment 精简成后端入参（只回传 id + 展示元信息）。
 *  fileUrl 可能是本地预览用的 base64 dataURL（几十 KB 起），后端存储/展示按 id 重签、
 *  不采用该值——提交前清洗掉，否则白白撑大请求体还会撞 2000 字符校验。 */
function toAttachmentInput(
  attachments?: Array<Pick<Attachment, "id" | "fileName" | "fileType"> & { fileUrl?: string; extractedText?: string }>,
) {
  return (attachments ?? []).map((a) => ({
    id: a.id,
    fileName: a.fileName,
    fileType: a.fileType,
    fileUrl:
      a.fileUrl && !a.fileUrl.startsWith("data:") && a.fileUrl.length <= 2000
        ? a.fileUrl
        : undefined,
    extractedText: a.extractedText,
  }));
}

export function createHttpIssueService(): IssueService {
  const list = (query: IssueQuery): Promise<Paged<Issue>> =>
    request<Paged<Issue>>(`/api/issues${buildQuery(query)}`);

  const get = (id: string): Promise<Issue> =>
    request<Issue>(`/api/issues/${encodeURIComponent(id)}`);

  const create = (input: NewIssueInput): Promise<Issue> =>
    request<Issue>(`/api/issues`, {
      method: "POST",
      body: JSON.stringify({ ...input, attachments: toAttachmentInput(input.attachments) }),
    });

  const findSimilar = (input: NewIssueInput): Promise<SimilarMatch[]> =>
    request<SimilarMatch[]>(`/api/issues/find-similar`, {
      method: "POST",
      body: JSON.stringify({ ...input, attachments: toAttachmentInput(input.attachments) }),
    });

  // analyze/adjust/chat 为长耗时 AI 操作：后端立即返回 taskId，这里内部轮询到完成，
  // 对外仍是「await 一个 Promise 拿结果」，故上层组件无需感知异步任务。
  const analyze = async (id: string): Promise<AnalysisVersion> => {
    const { taskId } = await request<{ taskId: string }>(
      `/api/issues/${encodeURIComponent(id)}/analyze`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return pollTask<AnalysisVersion>(taskId);
  };

  const adjust = async (
    id: string,
    message: string,
  ): Promise<{ message: IssueMessage; analysis: AnalysisVersion }> => {
    const { taskId } = await request<{ taskId: string }>(
      `/api/issues/${encodeURIComponent(id)}/adjust`,
      { method: "POST", body: JSON.stringify({ message }) },
    );
    return pollTask<{ message: IssueMessage; analysis: AnalysisVersion }>(taskId);
  };

  const sendChat = async (id: string, input: SendChatInput): Promise<SendChatResult> => {
    const { taskId } = await request<{ taskId: string }>(
      `/api/issues/${encodeURIComponent(id)}/chat`,
      {
        method: "POST",
        body: JSON.stringify({
          content: input.content,
          model: input.model,
          attachments: toAttachmentInput(input.attachments),
        }),
      },
    );
    return pollTask<SendChatResult>(taskId);
  };

  const resolveIssue = (
    id: string,
    input: { resolved: boolean; by: ChatUser; note?: string },
  ): Promise<Issue> =>
    request<Issue>(`/api/issues/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolved: input.resolved, note: input.note }),
    });

  const uploadAttachment = async (file: UploadFileInput): Promise<Attachment> => {
    let localFile: File;
    if (file.dataUrl) {
      const blob = await dataUrlToBlob(file.dataUrl);
      localFile = new File([blob], file.fileName, {
        type: blob.type || file.fileType || "application/octet-stream",
      });
    } else {
      // 无二进制内容时退化为空占位（后端会因缺文件报错，调用方应保证带 dataUrl）
      localFile = new File([], file.fileName, {
        type: file.fileType || "application/octet-stream",
      });
    }
    const res = await uploadResourceFile(localFile, "issue/attachments");
    return {
      id: res.fileId,
      fileName: res.fileName ?? file.fileName,
      // 本地预览优先用 dataURL（避免 OSS 强制下载头导致图片无法内联）；无则退回签名 URL
      fileUrl: file.dataUrl ?? res.signedUrl ?? "",
      fileType: res.mimeType ?? file.fileType,
      uploadedBy: "我",
      uploadedAt: new Date().toISOString(),
    };
  };

  const processAttachment = async (
    att: Attachment,
    mode: AiConfig["attachmentMode"],
  ): Promise<Attachment> => {
    if (!att.id) return att;
    const { extractedText } = await request<{ extractedText?: string }>(
      `/api/issues/process-attachment`,
      { method: "POST", body: JSON.stringify({ fileId: att.id, mode }) },
    );
    return { ...att, extractedText: extractedText ?? att.extractedText };
  };

  const getAiConfig = (): Promise<AiConfig> => request<AiConfig>(`/api/issues/ai/config`);

  const setAiConfig = (cfg: AiConfig): Promise<AiConfig> =>
    request<AiConfig>(`/api/issues/ai/config`, { method: "PUT", body: JSON.stringify(cfg) });

  const listAiModels = (): Promise<AiModelChoice[]> =>
    request<AiModelChoice[]>(`/api/issues/ai/models`);

  const adopt = (id: string, ref: Issue["adopted"]): Promise<Issue> =>
    request<Issue>(`/api/issues/${encodeURIComponent(id)}/adopt`, {
      method: "POST",
      body: JSON.stringify(ref ?? {}),
    });

  const stats = (): Promise<IssueStats> => request<IssueStats>(`/api/issues/stats`);

  const dimensionStats = (): Promise<DimensionStat[]> =>
    request<DimensionStat[]>(`/api/issues/dimension-stats`);

  const productOptions = (): Promise<string[]> => request<string[]>(`/api/issues/products`);

  return {
    list,
    get,
    create,
    findSimilar,
    analyze,
    adjust,
    sendChat,
    resolveIssue,
    uploadAttachment,
    processAttachment,
    getAiConfig,
    setAiConfig,
    listAiModels,
    adopt,
    stats,
    dimensionStats,
    productOptions,
  };
}
