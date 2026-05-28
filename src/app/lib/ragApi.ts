import { authFetch, readErrorMessage } from "./authSession";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type RagSourceType =
  | "kb"
  | "rd_task"
  | "rd_progress_note"
  | "rd_proposal"
  | "rd_daily_report"
  | "chat_group"
  | "chat_private"
  | "audit_log"
  | "candidate"
  | "image"
  | "file_asset";

export type RagCitation = {
  sourceType: RagSourceType;
  sourceId: string;
  title?: string;
  excerpt: string;
  url?: string;
  similarity: number;
};

export type RagChunk = {
  chunkId: string;
  sourceType: RagSourceType;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

export type RagChatResult = {
  answer: string;
  citations: RagCitation[];
  noResults: boolean;
  filteredByPermission: number;
  rawChunks: RagChunk[];
};

export type RagSearchResult = {
  results: RagChunk[];
  filteredByPermission: number;
};

// ─── API ──────────────────────────────────────────────────────────────────────

export type RagStatus = {
  embeddingConfigured: boolean;
  embeddingModel: string | null;
  chunkCount: number;
};

export async function ragStatus(): Promise<RagStatus> {
  const res = await authFetch("/api/rag/status");
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json() as Promise<RagStatus>;
}

export async function ragChat(query: string, opts: { topK?: number; sourceTypes?: RagSourceType[] } = {}): Promise<RagChatResult> {
  const res = await authFetch("/api/rag/chat", {
    method: "POST",
    body: JSON.stringify({ query, ...opts }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json() as Promise<RagChatResult>;
}

export async function ragSearch(query: string, opts: { topK?: number; sourceTypes?: RagSourceType[] } = {}): Promise<RagSearchResult> {
  const res = await authFetch("/api/rag/search", {
    method: "POST",
    body: JSON.stringify({ query, ...opts }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json() as Promise<RagSearchResult>;
}

/** 触发 KB → RAG 全量回填（仅 KB 管理权限可用） */
export async function backfillKbToRag(): Promise<{ total: number; succeeded: number; failed: number; failedIds: string[] }> {
  const res = await authFetch("/api/research-development/knowledge/rag-backfill", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json() as Promise<{ total: number; succeeded: number; failed: number; failedIds: string[] }>;
}

// ─── 来源类型 → 中文标签（前端展示） ──────────────────────────────────────────

export const SOURCE_TYPE_LABELS: Record<RagSourceType, string> = {
  kb: "知识库",
  rd_task: "研发任务",
  rd_progress_note: "进度留痕",
  rd_proposal: "立项",
  rd_daily_report: "日报",
  chat_group: "群聊",
  chat_private: "私聊",
  audit_log: "操作留痕",
  candidate: "简历",
  image: "AI 生图",
  file_asset: "文件",
};
